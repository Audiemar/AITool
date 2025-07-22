// netlify/functions/process-ai-test.js
import fetch from 'node-fetch';

// AI API Configurations
const AI_CONFIG = {
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }),
    body: (prompt) => ({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
      temperature: 0.7
    })
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    }),
    body: (prompt) => ({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
    headers: (apiKey) => ({
      'Content-Type': 'application/json'
    }),
    body: (prompt) => ({
      contents: [{ parts: [{ text: prompt }] }]
    })
  }
};

// Call individual AI APIs
async function callAI(provider, prompt, apiKey) {
  const config = AI_CONFIG[provider];
  const url = provider === 'google' ? `${config.url}?key=${apiKey}` : config.url;
  
  try {
    console.log(`Calling ${provider} API...`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: config.headers(apiKey),
      body: JSON.stringify(config.body(prompt))
    });

    if (!response.ok) {
      throw new Error(`${provider} API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Extract response text based on provider
    switch (provider) {
      case 'openai':
        return data.choices[0].message.content;
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

// Send results email
async function sendResultsEmail(email, orderData, results) {
  try {
    const report = generateComparisonReport(results, orderData.prompt);
    
    const emailData = {
      to_email: email,
      order_number: orderData.orderNumber,
      prompt: orderData.prompt,
      report: report,
      cost: orderData.amount || orderData.cost,
      payment_id: orderData.paymentId,
      ais_tested: Object.keys(results).join(', '),
      winner: Object.keys(results).sort((a, b) => results[b].analysis.score - results[a].analysis.score)[0],
      winner_score: Math.max(...Object.values(results).map(r => r.analysis.score))
    };

    // Use EmailJS to send results
    const emailResponse = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: 'template_test_results',
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        template_params: emailData
      })
    });

    if (emailResponse.ok) {
      console.log('Results email sent successfully to:', email);
      return true;
    } else {
      console.error('Failed to send results email:', emailResponse.status);
      return false;
    }
  } catch (error) {
    console.error('Error sending results email:', error);
    return false;
  }
}

// Main function
export default async (request, context) => {
  // Handle CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const orderData = await request.json();
    
    console.log(`Processing AI test order ${orderData.orderNumber} for ${orderData.email}`);
    console.log(`Prompt: "${orderData.prompt}"`);
    console.log(`Selected AIs: ${orderData.selectedAIs?.join(', ') || 'ChatGPT, Claude, Gemini'}`);

    const results = {};
    const selectedAIs = orderData.selectedAIs || ['ChatGPT', 'Claude', 'Gemini'];
    
    const apiKeys = {
      ChatGPT: process.env.OPENAI_API_KEY,
      Claude: process.env.ANTHROPIC_API_KEY,
      Gemini: process.env.GOOGLE_API_KEY
    };

    const providers = {
      ChatGPT: 'openai',
      Claude: 'anthropic',
      Gemini: 'google'
    };

    // Process each selected AI
    for (const ai of selectedAIs) {
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

    return new Response(JSON.stringify({
      success: true,
      orderNumber: orderData.orderNumber,
      results,
      emailSent,
      message: 'AI testing completed successfully'
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('Error processing AI test:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};
