// netlify/functions/process-ai-test-fixed.js

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
  }
};

async function callAI(provider, prompt, apiKey) {
  const config = AI_CONFIG[provider];
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

function generateComparisonReport(results, prompt) {
  const aiNames = Object.keys(results);
  const sorted = aiNames.sort((a, b) => results[b].analysis.score - results[a].analysis.score);
  let report = `# AI Comparison Report\n\n**Prompt:** \"${prompt}\"\n**Date:** ${new Date().toLocaleDateString()}\n**AIs Tested:** ${aiNames.join(', ')}\n\n## Summary\n\n**Winner:** ${sorted[0]} (${results[sorted[0]].analysis.score}/10)\n\n## Detailed Results\n\n`;
  sorted.forEach((ai, i) => {
    const a = results[ai].analysis;
    report += `### ${i + 1}. ${ai} - ${a.score}/10\n\n**Response:**\n${results[ai].response}\n\n**Analysis:**\n- Word Count: ${a.wordCount}\n- Sentences: ${a.sentences}\n- Paragraphs: ${a.paragraphs}\n\n**Strengths:** ${a.pros.join(', ')}\n`;
    if (a.cons.length) report += `**Areas for Improvement:** ${a.cons.join(', ')}\n`;
    report += `\n---\n\n`;
  });
  report += `## Recommendations\n\n**Best Overall:** ${sorted[0]} with score ${results[sorted[0]].analysis.score}/10\n`;
  return report;
}

async function sendResultsEmail(email, orderData, results) {
  console.log('📨 Preparing to send results email...');
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    console.error('❌ Invalid or missing email address:', email);
    return false;
  }
  try {
    const emailData = {
      service_id: process.env.EMAILJS_SERVICE_ID || 'service_6deh10r',
      template_id: process.env.EMAILJS_TEMPLATE_ID || 'template_test_results',
      user_id: process.env.EMAILJS_PUBLIC_KEY || 'WwSbSdi4EaiQMExvs',
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
       template_params: {
        email: email, // <--- Make sure this key matches your EmailJS template!
        order_number: orderData.orderNumber,
        prompt: orderData.prompt,
        ais: Object.keys(results).join(', '),
        cost: orderData.amount || orderData.cost,
        payment_id: orderData.paymentId
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
    return response.ok;
  } catch (err) {
    console.error('🔥 sendResultsEmail() error:', err);
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const orderData = JSON.parse(event.body);
    console.log(`🧪 Order ${orderData.orderNumber} from ${orderData.email}`);
    const selectedAIs = orderData.selectedAIs || ['Claude', 'Gemini'];

    const apiKeys = {
      Claude: process.env.ANTHROPIC_API_KEY,
      Gemini: process.env.GOOGLE_API_KEY
    };

    const providers = {
      Claude: 'anthropic',
      Gemini: 'google'
    };

    const results = {};
    // Uncomment the block below and remove the mock for live AI calls
    /*
    for (const ai of selectedAIs) {
      const provider = providers[ai];
      const key = apiKeys[ai];
      if (!key) {
        results[ai] = { response: `Missing API key for ${ai}`, analysis: { score: 0, pros: [], cons: ['Missing key'] } };
        continue;
      }
      console.log(`⚙️ Calling ${ai}...`);
      const res = await callAI(provider, orderData.prompt, key);
      results[ai] = {
        response: res,
        analysis: analyzeResponse(res, provider),
        timestamp: new Date().toISOString()
      };
    }
    */

    // TEMPORARY MOCK AI RESPONSES FOR DEBUGGING EMAIL SENDING (COMMENT OUT WHEN TESTING LIVE AI)
    for (const ai of selectedAIs) {
        let mockResponse = "";
        if (ai === 'Claude') {
            mockResponse = "This is a mock response from Claude for debugging purposes. It's a placeholder to test the email functionality without hitting the actual AI API. This helps save costs during development.";
        } else if (ai === 'Gemini') {
            mockResponse = "Mock response from Gemini. For testing email integration, we are using simulated AI output instead of live API calls. This is efficient for debugging the email template and sending process.";
        } else {
            mockResponse = `Mock response for unknown AI: ${ai}.`;
        }
        results[ai] = {
            response: mockResponse,
            analysis: analyzeResponse(mockResponse, ai.toLowerCase()), // Still run analysis on mock response
            timestamp: new Date().toISOString()
        };
    }
    // END TEMPORARY MOCK

    const emailSent = await sendResultsEmail(orderData.email, orderData, results);
    console.log(`✅ Order ${orderData.orderNumber} complete. Email sent: ${emailSent}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, orderNumber: orderData.orderNumber, results, emailSent, message: 'AI test complete' })
    };
  } catch (error) {
    console.error('❌ Handler error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
