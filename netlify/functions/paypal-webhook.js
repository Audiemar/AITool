// netlify/functions/paypal-webhook.js
export default async (request, context) => {
  console.log('PayPal webhook received');

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
    const payload = await request.text();
    const headers = Object.fromEntries(request.headers.entries());
    
    console.log('PayPal webhook payload received:', {
      payloadLength: payload.length,
      eventType: JSON.parse(payload).event_type
    });

    const paypalEvent = JSON.parse(payload);

    // Only process completed payments
    if (paypalEvent.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const resource = paypalEvent.resource;
      
      console.log('Processing completed payment:', resource.id);

      // Extract order details from the payment
      const orderDetails = {
        paymentId: resource.id,
        amount: resource.amount.value,
        currency: resource.amount.currency_code,
        email: resource.payer?.email_address,
        timestamp: paypalEvent.create_time
      };

      // Extract custom data from the purchase unit if available
      let orderData = {
        prompt: "Sample AI test prompt", // Default
        selectedAIs: ['ChatGPT', 'Claude', 'Gemini'], // Default
        orderNumber: 'WH' + Date.now().toString(36).toUpperCase()
      };

      // Try to extract custom data from description or custom_id
      try {
        if (resource.custom_id) {
          const customData = JSON.parse(resource.custom_id);
          orderData = { ...orderData, ...customData };
        }
      } catch (error) {
        console.log('Could not parse custom data, using defaults');
      }

      // Combine all order information
      const completeOrder = {
        ...orderData,
        ...orderDetails
      };

      console.log('Triggering AI processing for order:', completeOrder.orderNumber);

      // Trigger AI processing
      try {
        const response = await fetch(`${process.env.URL}/.netlify/functions/process-ai-test`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(completeOrder)
        });

        if (response.ok) {
          console.log('AI processing triggered successfully');
        } else {
          console.error('Failed to trigger AI processing:', response.status);
        }
      } catch (error) {
        console.error('Error triggering AI processing:', error);
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Payment processed, AI testing initiated',
        orderNumber: completeOrder.orderNumber
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Acknowledge other webhook events
    return new Response(JSON.stringify({
      success: true,
      message: 'Webhook received'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('PayPal webhook error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: 'Webhook processing failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
