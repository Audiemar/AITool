// netlify/functions/process-ai-test-credits.js
// Updated function for credit-based system

// AI API Configurations
const AI_CONFIG = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    }),
    body: (prompt) => ({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
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
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }),
    body: (prompt) => ({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000
    })
  }
};

async function callAI(provider, prompt, apiKey) {
  const config = AI_CONFIG[provider];
  if (!config) {
      throw new Error(`Configuration for AI provider '${provider}' not found.`);
  }

  const url = provider === 'google' ? `${config.url}?key=${apiKey}` : config.url;

  try {
    console.log(`Calling ${provider} API...`);
    const requestBody = JSON.stringify(config.body(prompt));
    const response = await fetch(url, {
      method: 'POST',
      headers: config.headers(apiKey),
      body: requestBody
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${provider} API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    switch (provider) {
      case 'anthropic':
        return data.content[0].text;
      case 'google':
        return data.candidates[0].content.parts[0].text;
      case 'openai':
        return data.choices[0].message.content;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  } catch (error) {
    console.error(`Error calling ${provider}:`, error);
    return `Error: Could not get response from ${provider}. ${error.message}`;
  }
}

function analyzeResponse(response, provider) {
  const wordCount = response.split(/\s+/).length;
  const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  const paragraphs = response.split(/\n\s*\n/).length;
  const hasStructure = /\n|\*|\-|\d+\./.test(response);
  const isDetailed = wordCount > 75;
  const isCoherent = sentences > 1 && wordCount / sentences < 40;
  const hasExamples = /example|for instance/i.test(response);
  const isActionable = /recommend|suggest|should/i.test(response);
  let score = 5 + (isDetailed ? 1 : 0) + (hasStructure ? 1 : 0) + (isCoherent ? 1 : 0) + (hasExamples ? 0.5 : 0) + (isActionable ? 0.5 : 0);
  if (response.length > 300) score += 0.5;
  if (paragraphs > 1) score += 0.5;

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
    length: response.length,
    pros: pros.slice(0, 3),
    cons: cons.slice(0, 2)
  };
}

function generateComparisonReport(results, prompt, creditInfo) {
  const aiNames = Object.keys(results);
  const sorted = aiNames.sort((a, b) => results[b].analysis.score - results[a].analysis.score);
  
  let report = `# AI Comparison Report\n\n`;
  report += `**Prompt:** "${prompt}"\n`;
  report += `**Date:** ${new Date().toLocaleDateString()}\n`;
  report += `**AIs Tested:** ${aiNames.join(', ')}\n`;
  report += `**Credits Used:** ${creditInfo.used} credits\n`;
  if (creditInfo.refunded > 0) {
    report += `**Credits Refunded:** ${creditInfo.refunded} credits (for failed AIs)\n`;
  }
  report += `\n## Summary\n\n`;
  
  const workingAIs = aiNames.filter(ai => !results[ai].response.includes('Error:'));
  if (workingAIs.length > 0) {
    report += `**Winner:** ${sorted[0]} (${results[sorted[0]].analysis.score}/10)\n\n`;
  } else {
    report += `**Result:** All AIs failed - credits have been refunded\n\n`;
    return report;
  }
  
  report += `## Detailed Results\n\n`;
  
  sorted.forEach((ai, i) => {
    const result = results[ai];
    const analysis = result.analysis;
    
    if (result.response.includes('Error:')) {
      report += `### ${i + 1}. ${ai} - FAILED ❌\n\n`;
      report += `**Error:** ${result.response}\n`;
      report += `**Credit Status:** Refunded ✅\n\n---\n\n`;
    } else {
      report += `### ${i + 1}. ${ai} - ${analysis.score}/10\n\n`;
      report += `**Response:**\n\`\`\`\n${result.response}\n\`\`\`\n\n`;
      report += `**Analysis:**\n`;
      report += `- Word Count: ${analysis.wordCount}\n`;
      report += `- Sentences: ${analysis.sentences}\n`;
      report += `- Paragraphs: ${analysis.paragraphs}\n\n`;
      report += `**Strengths:** ${analysis.pros.join(', ')}\n`;
      if (analysis.cons.length) report += `**Areas for Improvement:** ${analysis.cons.join(', ')}\n`;
      report += `\n---\n\n`;
    }
  });
  
  report += `## Cost Summary\n\n`;
  report += `- **Credits Used:** ${creditInfo.used}\n`;
  report += `- **Successful Tests:** ${workingAIs.length}\n`;
  if (creditInfo.refunded > 0) {
    report += `- **Failed Tests:** ${creditInfo.refunded}\n`;
    report += `- **Credits Refunded:** ${creditInfo.refunded}\n`;
    report += `- **Net Cost:** ${creditInfo.used - creditInfo.refunded} credits\n`;
  }
  
  if (workingAIs.length > 0) {
    report += `\n## Recommendations\n\n`;
    report += `**Best Overall:** ${sorted[0]} with score ${results[sorted[0]].analysis.score}/10\n`;
    report += `**Value:** You got ${workingAIs.length} successful AI comparison${workingAIs.length !== 1 ? 's' : ''} for ${creditInfo.used - creditInfo.refunded} credit${(creditInfo.used - creditInfo.refunded) !== 1 ? 's' : ''}\n`;
  }
  
  return report;
}

async function sendResultsEmail(email, orderData, results, comparisonReportMarkdown) {
  console.log('📨 Preparing to send results email...');
  console.log('Recipient email:', email); 
  
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    console.error('❌ Invalid or missing email address:', email);
    return false;
  }
  
  try {
    const emailData = {
      service_id: process.env.EMAILJS_SERVICE_ID || 'service_6deh10r',
      template_id: process.env.EMAILJS_TEMPLATE_ID || 'template_test_results',
      user_id: process.env.EMAILJS_PUBLIC_KEY || 'WwSbSdi4EaiQMExvs',
      accessToken: process.env.EMAILJS_PRIVATE_KEY,  // 🔧 THIS IS THE FIX!
      template_params: {
        email: email,
        order_number: orderData.orderNumber,
        prompt: orderData.prompt,
        ais: Object.keys(results).join(', '),
        cost: `${orderData.creditsUsed} credit${orderData.creditsUsed !== 1 ? 's' : ''}`,
        payment_id: orderData.paymentId,
        report_content: comparisonReportMarkdown,
        user_id: orderData.userId || 'N/A',
        credits_used: orderData.creditsUsed,
        credits_refunded: orderData.creditsRefunded || 0
      }
    };

    console.log('📧 Sending email with payload:', emailData);
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailData)
    });
    
    const text = await response.text();
    console.log('📬 EmailJS response:', response.status, text);
    console.log('📧 Email sent:', response.ok);
    return response.ok;
  } catch (err) {
    console.error('🔥 sendResultsEmail() error:', err);
    return false;
  }
}

exports.handler = async (event) => {
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
    console.log(`🧪 Credit-based Order ${orderData.orderNumber} from ${orderData.email}`);
    console.log(`👤 User ID: ${orderData.userId}`);
    console.log(`💳 Credits Used: ${orderData.creditsUsed}`);
    
    const selectedAIs = orderData.selectedAIs || ['Claude', 'Gemini', 'ChatGPT']; 

    const apiKeys = {
      Claude: process.env.ANTHROPIC_API_KEY,
      Gemini: process.env.GOOGLE_API_KEY,
      ChatGPT: process.env.OPENAI_API_KEY
    };

    const providers = {
      Claude: 'anthropic',
      Gemini: 'google',
      ChatGPT: 'openai'
    };

    const results = {};
    let failedCount = 0;
    
    // Test each selected AI
    for (const ai of selectedAIs) {
      const provider = providers[ai];
      const key = apiKeys[ai];
      
      if (!key) {
        console.log(`❌ Missing API key for ${ai}`);
        results[ai] = { 
          response: `Error: Missing API key for ${ai}`, 
          analysis: { score: 0, pros: [], cons: ['Missing API key'] },
          timestamp: new Date().toISOString()
        };
        failedCount++;
        continue;
      }
      
      console.log(`⚙️ Testing ${ai} (${provider})...`);
      const response = await callAI(provider, orderData.prompt, key);
      
      if (response.includes('Error:')) {
        failedCount++;
        console.log(`❌ ${ai} failed`);
      } else {
        console.log(`✅ ${ai} succeeded`);
      }
      
      results[ai] = {
        response: response,
        analysis: analyzeResponse(response, provider),
        timestamp: new Date().toISOString()
      };
    }

    // Calculate credit refunds
    const creditsRefunded = failedCount;
    const creditInfo = {
      used: orderData.creditsUsed,
      refunded: creditsRefunded,
      net: orderData.creditsUsed - creditsRefunded
    };

    console.log(`💰 Credit Summary: Used ${creditInfo.used}, Refunded ${creditInfo.refunded}, Net ${creditInfo.net}`);

    // Generate the comparison report
    const comparisonReportMarkdown = generateComparisonReport(results, orderData.prompt, creditInfo);
    
    // Add refund info to order data
    orderData.creditsRefunded = creditsRefunded;
    
    // Send the results email
    const emailSent = await sendResultsEmail(orderData.email, orderData, results, comparisonReportMarkdown);
    console.log(`📧 Email sent: ${emailSent}`);

    console.log(`✅ Order ${orderData.orderNumber} complete. Email sent: ${emailSent}`);

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
        creditInfo: creditInfo,
        message: 'AI test complete with credit system',
        failedAIs: selectedAIs.filter(ai => results[ai].response.includes('Error:'))
      })
    };
  } catch (error) {
    console.error('❌ Handler error:', error);
    return {
      statusCode: 500,
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*' 
      },
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
};
