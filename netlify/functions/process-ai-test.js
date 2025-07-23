// netlify/functions/process-ai-test-fixed.js
// Fixed version with OpenAI disabled and correct EmailJS setup

// AI API Configurations (OpenAI disabled temporarily)
const AI_CONFIG = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    }),
    body: (prompt) => ({
      model: 'claude-3-5-sonnet-20241022',  // Updated model
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',  // Updated endpoint
    headers: (apiKey) => ({
      'Content-Type': 'application/json'
    }),
    body: (prompt) => ({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.7
      }
    })
  }
};

// Call individual AI APIs with enhanced debugging
async function callAI(provider, prompt, apiKey) {
  const config = AI_CONFIG[provider];
  const url = provider === 'google' ? `${config.url}?key=${apiKey}` : config.url;
  
  try {
    console.log(`Calling ${provider} API...`);
    console.log(`URL: ${url}`);
    console.log(`API Key length: ${apiKey ? apiKey.length : 'missing'}`);
    console.log(`API Key starts with: ${apiKey ? apiKey.substring(0, 10) + '...' : 'N/A'}`);
    
    const requestBody = JSON.stringify(config.body(prompt));
    console.log(`Request body: ${requestBody.substring(0, 200)}...`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: config.headers(apiKey),
      body: requestBody
    });

    console.log(`${provider} response status: ${response.status}`);
    console.log(`${provider} response headers:`, Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`${provider} error response:`, errorText);
      throw new Error(`${provider} API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`${provider} success response received, length:`, JSON.stringify(data).length);
    
    // Extract response text based on provider
    switch (provider) {
      case 'openai':
        return data.choices[0].message.content;
      case 'anthropic':
        if (!data.content || !data.content[0] || !data.content[0].text) {
          console.log('Unexpected Anthropic response structure:', data);
          throw new Error('Unexpected response structure from Anthropic');
        }
        return data.content[0].text;
      case 'google':
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
          console.log('Unexpected Google response structure:', data);
          throw new Error('Unexpected response structure from Google');
        }
        return data.candidates[0].content.parts[0].text;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  } catch (error) {
    console.error(`Error calling ${provider}:`, error);
    return `Error: Could not get response from ${provider}. ${error.message}`;
  }
}

// Analyze AI response quality
function analyzeResponse(response, provider) {
  const length = response.length;
  const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  const wordCount = response.split(/\s+/).length;
  const paragraphs = response.split(/\n\s*\n/).length;
  
  // Quality metrics
  const hasStructure = response.includes('\n') || response.includes('*') || response.includes('-') || response.includes('1.');
  const isDetailed = wordCount > 75;
  const isCoherent = sentences > 1 && wordCount / sentences < 40;
  const hasExamples = response.toLowerCase().includes('example') || response.toLowerCase().includes('for instance');
  const isActionable = response.toLowerCase().includes('recommend') || response.toLowerCase().includes('suggest') || response.toLowerCase().includes('should');
  
  // Calculate score
  let score = 5; // Base score
  if (isDetailed) score += 1;
  if (hasStructure) score += 1;
  if (isCoherent) score += 1;
  if (hasExamples) score += 0.5;
  if (isActionable) score += 0.5;
  if (length > 300) score += 0.5;
  if (paragraphs > 1) score += 0.5;
  
  // Determine pros and cons
  const pros = [];
  const cons = [];
  
  if (isDetailed) pros.push('Detailed and comprehensive');
  if (hasStructure) pros.push('Well-structured format');
  if (isCoherent) pros.push('Clear and coherent');
  if (hasExamples) pros.push('Includes helpful examples');
  if (isActionable) pros.push('Provides actionable advice');
  
  if (!isDetailed) cons.push('Could be more detailed');
  if (!hasStructure) cons.push('Could use better formatting');
  if (!isCoherent) cons.push('Could improve flow');
  if (wordCount < 50) cons.push('Quite brief');
  
  return {
    score: Math.min(Math.round(score * 10) / 10, 10),
    wordCount,
    sentences,
    paragraphs,
    length,
    pros: pros.slice(0, 3),
    cons: cons.slice(0, 2)
  };
}

// Generate comparison report
function generateComparisonReport(results, prompt) {
  const aiNames = Object.keys(results);
  const sortedByScore = aiNames.sort((a, b) => results[b].analysis.score - results[a].analysis.score);
  
  let report = `# AI Comparison Report\n\n`;
  report += `**Prompt:** "${prompt}"\n`;
  report += `**Date:** ${new Date().toLocaleDateString()}\n`;
  report += `**AIs Tested:** ${aiNames.join(', ')}\n\n`;
  
  // Summary
  report += `## Summary\n\n`;
  report += `**Winner:** ${sortedByScore[0]} (${results[sortedByScore[0]].analysis.score}/10)\n\n`;
  
  // Detailed Results
  report += `## Detailed Results\n\n`;
  
  sortedByScore.forEach((ai, index) => {
    const result = results[ai];
    const analysis = result.analysis;
    
    report += `### ${index + 1}. ${ai} - ${analysis.score}/10\n\n`;
    report += `**Response:**\n${result.response}\n\n`;
    report += `**Analysis:**\n`;
    report += `- Word Count: ${analysis.wordCount}\n`;
    report += `- Sentences: ${analysis.sentences}\n`;
    report += `- Paragraphs: ${analysis.paragraphs}\n\n`;
    report += `**Strengths:** ${analysis.pros.join(', ')}\n`;
    if (analysis.cons.length > 0) {
      report += `**Areas for Improvement:** ${analysis.cons.join(', ')}\n`;
    }
    report += `\n---\n\n`;
  });
  
  // Recommendations
  report += `## Recommendations\n\n`;
  report += `**Best Overall:** ${sortedByScore[0]} provided the highest quality response with a score of ${results[sortedByScore[0]].analysis.score}/10.\n\n`;
  
  if (aiNames.length > 1) {
    report += `**Key Differences:**\n`;
    const topTwo = sortedByScore.slice(0, 2);
    report += `- ${topTwo[0]} excelled in: ${results[topTwo[0]].analysis.pros.join(', ')}\n`;
    if (topTwo.length > 1) {
      report += `- ${topTwo[1]} was strong in: ${results[topTwo[1]].analysis.pros.join(', ')}\n`;
    }
  }
  
  report += `\n**For Future Use:** Consider ${sortedByScore[0]} for similar prompts requiring ${results[sortedByScore[0]].analysis.pros[0]?.toLowerCase() || 'high quality responses'}.\n`;
  
  return report;
}

// Send results email with correct EmailJS configuration
async function sendResultsEmail(email, orderData, results) {
  try {
    const report = generateComparisonReport(results, orderData.prompt);
    
    // Fixed EmailJS data structure
    const emailData = {
      service_id: 'service_6deh10r',  // Your service ID from the screenshot
      template_id: 'template_test_results',  // Your template ID from the screenshot
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      template_params: {
        // These match your template variables
        email: email,  // {{email}} in your template
        order_number: orderData.orderNumber,  // {{order_number}}
        prompt: orderData.prompt,  // {{prompt}}
        ais: Object.keys(results).join(', '),  // {{ais}}
        cost: orderData.amount || orderData.cost,  // {{cost}}
        payment_id: orderData.paymentId,  // {{payment_id}}
        report: report,  // Full report for the email body
        winner: Object.keys(results).sort((a, b) => results[b].analysis.score - results[a].analysis.score)[0],
        winner_score: Math.max(...Object.values(results).map(r => r.analysis.score))
      }
    };

    console.log('Sending email with data:', emailData);

    // Use EmailJS API
    const emailResponse = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailData)
    });

    const responseText = await emailResponse.text();
    console.log('EmailJS response:', emailResponse.status, responseText);

    if (emailResponse.ok) {
      console.log('Results email sent successfully to:', email);
      return true;
    } else {
      console.error('Failed to send results email:', emailResponse.status, responseText);
      return false;
    }
  } catch (error) {
    console.error('Error sending results email:', error);
    return false;
  }
}

// Main function
exports.handler = async (event, context) => {
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const orderData = JSON.parse(event.body);
    
    console.log(`Processing AI test order ${orderData.orderNumber} for ${orderData.email}`);
    console.log(`Prompt: "${orderData.prompt}"`);
    console.log(`Selected AIs: ${orderData.selectedAIs?.join(', ') || 'Claude, Gemini'}`);

    const results = {};
    const selectedAIs = orderData.selectedAIs || ['Claude', 'Gemini']; // Removed ChatGPT
    
    const apiKeys = {
      // ChatGPT: process.env.OPENAI_API_KEY,  // Disabled
      Claude: process.env.ANTHROPIC_API_KEY,
      Gemini: process.env.GOOGLE_API_KEY
    };

    const providers = {
      // ChatGPT: 'openai',  // Disabled
      Claude: 'anthropic',
      Gemini: 'google'
    };

    // Check environment variables
    console.log('Environment check:', {
      // OpenAI: !!apiKeys.ChatGPT,  // Disabled
      Anthropic: !!apiKeys.Claude,
      Google: !!apiKeys.Gemini,
      EmailJS_Service: !!process.env.EMAILJS_SERVICE_ID,
      EmailJS_Key: !!process.env.EMAILJS_PUBLIC_KEY
    });

    // Process each selected AI (skip ChatGPT for now)
    for (const ai of selectedAIs) {
      if (ai === 'ChatGPT') {
        console.log('⚠️ Skipping ChatGPT - temporarily disabled');
        results[ai] = {
          response: 'ChatGPT temporarily unavailable - API key configuration in progress',
          analysis: { score: 0, error: 'Temporarily disabled', pros: [], cons: ['Service temporarily unavailable'] },
          timestamp: new Date().toISOString()
        };
        continue;
      }

      const provider = providers[ai];
      const apiKey = apiKeys[ai];

      if (!apiKey) {
        console.error(`Missing API key for ${ai}`);
        results[ai] = {
          response: `Error: ${ai} API key not configured`,
          analysis: { score: 0, error: 'API key missing', pros: [], cons: ['Service unavailable'] },
          timestamp: new Date().toISOString()
        };
        continue;
      }

      console.log(`Testing with ${ai}...`);
      const response = await callAI(provider, orderData.prompt, apiKey);
      const analysis = analyzeResponse(response, provider);

      results[ai] = {
        response,
        analysis,
        timestamp: new Date().toISOString()
      };
      
      console.log(`${ai} completed with score: ${analysis.score}/10`);
    }

    // Send results email
    const emailSent = await sendResultsEmail(orderData.email, orderData, results);
    
    console.log(`Order ${orderData.orderNumber} completed successfully. Email sent: ${emailSent}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        orderNumber: orderData.orderNumber,
        results,
        emailSent,
        message: 'AI testing completed successfully',
        note: 'ChatGPT temporarily disabled - only Claude and Gemini tested'
      })
    };

  } catch (error) {
    console.error('Error processing AI test:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      })
    };
  }
};
