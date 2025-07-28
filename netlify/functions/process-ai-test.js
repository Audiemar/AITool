// netlify/functions/process-ai-test.js - Updated to call your backend for credits
exports.handler = async (event, context) => {
    // CORS headers for all responses
    const corsHeaders = {
        'Access-Control-Allow-Origin': 'https://testaitools.online',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };

    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        };
    }

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const requestData = JSON.parse(event.body);
        const {
            orderNumber,
            email,
            userId,
            prompt,
            selectedAIs,
            creditsUsed
        } = requestData;

        console.log(`Processing AI test for order: ${orderNumber}`);

        // 1. FIRST: Deduct credits from your backend
        const deductResponse = await fetch('https://testaitools.online/api-backend/deduct-credits.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                creditsUsed: creditsUsed,
                orderNumber: orderNumber,
                testDetails: `AI test: ${selectedAIs.join(', ')}`,
                netlifySecret: process.env.NETLIFY_SECRET_KEY || 'your-netlify-secret-key-2024'
            })
        });

        const deductResult = await deductResponse.json();
        
        if (!deductResponse.ok) {
            console.error('Failed to deduct credits:', deductResult);
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: deductResult.error || 'Failed to deduct credits'
                })
            };
        }

        console.log('Credits deducted successfully:', deductResult);

        // 2. NOW process the AI requests
        const aiResults = {};
        let allSuccessful = true;
        let errorMessage = '';

        try {
            // Process each AI
            for (const aiName of selectedAIs) {
                try {
                    const aiResult = await processAI(aiName, prompt);
                    aiResults[aiName] = aiResult;
                    console.log(`${aiName} completed successfully`);
                } catch (aiError) {
                    console.error(`${aiName} failed:`, aiError);
                    aiResults[aiName] = {
                        error: aiError.message,
                        success: false
                    };
                    allSuccessful = false;
                    errorMessage += `${aiName}: ${aiError.message}; `;
                }
            }

            // 3. Send email with results
            let emailSent = false;
            try {
                await sendResultsEmail(email, orderNumber, prompt, aiResults);
                emailSent = true;
                console.log('Results email sent successfully');
            } catch (emailError) {
                console.error('Failed to send email:', emailError);
                // Don't fail the entire process for email issues
            }

            // 4. If ALL AIs failed, refund the credits
            if (!allSuccessful) {
                console.log('Some AIs failed, considering refund...');
                
                // Count successful AIs
                const successfulAIs = Object.values(aiResults).filter(result => !result.error).length;
                const failedCredits = creditsUsed - successfulAIs;
                
                if (failedCredits > 0) {
                    console.log(`Refunding ${failedCredits} credits for failed AIs`);
                    
                    const refundResponse = await fetch('https://testaitools.online/api-backend/refund-credits.php', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            email: email,
                            creditsToRefund: failedCredits,
                            orderNumber: orderNumber,
                            reason: `Partial refund: ${errorMessage}`,
                            netlifySecret: process.env.NETLIFY_SECRET_KEY || 'your-netlify-secret-key-2024'
                        })
                    });
                    
                    if (refundResponse.ok) {
                        console.log('Partial refund processed successfully');
                    }
                }
            }

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    orderNumber: orderNumber,
                    emailSent: emailSent,
                    testResults: aiResults,
                    creditsDeducted: deductResult.creditsDeducted,
                    newCreditBalance: deductResult.newCredits
                })
            };

        } catch (processingError) {
            console.error('AI processing completely failed:', processingError);
            
            // Refund all credits if processing fails completely
            try {
                await fetch('https://testaitools.online/api-backend/refund-credits.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        email: email,
                        creditsToRefund: creditsUsed,
                        orderNumber: orderNumber,
                        reason: `Complete refund: ${processingError.message}`,
                        netlifySecret: process.env.NETLIFY_SECRET_KEY || 'your-netlify-secret-key-2024'
                    })
                });
                console.log('Full refund processed');
            } catch (refundError) {
                console.error('Failed to process refund:', refundError);
            }

            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: 'AI processing failed',
                    refunded: true
                })
            };
        }

    } catch (error) {
        console.error('General error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: 'Internal server error'
            })
        };
    }
};

// AI Processing Functions
async function processAI(aiName, prompt) {
    const config = getAIConfig(aiName);
    
    if (!config) {
        throw new Error(`AI configuration not found for ${aiName}`);
    }

    try {
        const response = await fetch(config.url, {
            method: 'POST',
            headers: config.headers,
            body: JSON.stringify(config.body(prompt)),
            signal: AbortSignal.timeout(30000) // 30 second timeout
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return config.parseResponse(data);

    } catch (error) {
        if (error.name === 'TimeoutError') {
            throw new Error('Request timed out after 30 seconds');
        }
        throw new Error(`API request failed: ${error.message}`);
    }
}

function getAIConfig(aiName) {
    const configs = {
        'ChatGPT': {
            url: 'https://api.openai.com/v1/chat/completions',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: (prompt) => ({
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 1000,
                temperature: 0.7
            }),
            parseResponse: (data) => ({
                response: data.choices[0]?.message?.content || 'No response',
                usage: data.usage,
                success: true
            })
        },
        'Claude': {
            url: 'https://api.anthropic.com/v1/messages',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: (prompt) => ({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 1000,
                messages: [{ role: 'user', content: prompt }]
            }),
            parseResponse: (data) => ({
                response: data.content[0]?.text || 'No response',
                usage: data.usage,
                success: true
            })
        },
        'Gemini': {
            url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': process.env.GEMINI_API_KEY
            },
            body: (prompt) => ({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    maxOutputTokens: 1000,
                    temperature: 0.7
                }
            }),
            parseResponse: (data) => ({
                response: data.candidates[0]?.content?.parts[0]?.text || 'No response',
                usage: data.usageMetadata,
                success: true
            })
        }
    };

    return configs[aiName];
}

async function sendResultsEmail(email, orderNumber, prompt, results) {
    try {
        console.log('Sending email request to PHP endpoint...');
        
        const response = await fetch('https://testaitools.online/api-backend/send-test-results.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                orderNumber: orderNumber,
                prompt: prompt,
                results: results,
                netlifySecret: process.env.NETLIFY_SECRET_KEY || 'your-netlify-secret-key-2024'
            })
        });
        
        console.log('PHP response status:', response.status);
        console.log('PHP response headers:', Object.fromEntries(response.headers.entries()));
        
        const rawText = await response.text();
        console.log('PHP raw response:', rawText);
        
        let result;
        try {
            result = JSON.parse(rawText);
        } catch (parseError) {
            console.error('Failed to parse PHP response as JSON:', parseError);
            console.error('Raw response was:', rawText);
            throw new Error(`PHP returned invalid JSON: ${rawText.substring(0, 100)}...`);
        }
        
        console.log('PHP parsed response:', result);
        
        if (!response.ok || !result.success) {
            throw new Error(result.error || `PHP responded with ${response.status}: ${result.message || 'Unknown error'}`);
        }
        
        console.log('AI results email sent successfully:', result);
        return true;
        
    } catch (error) {
        console.error('Failed to send AI results email:', error);
        throw error;
    }
}
