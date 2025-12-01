import express from "express"
import cors from "cors"
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import dotenv from "dotenv"
import helmet from "helmet"
import rateLimit from "express-rate-limit"

dotenv.config()

const app = express()
const isProduction = process.env.NODE_ENV === 'production'

// ==================== FIXED CORS CONFIGURATION ====================
const allowedOrigins = [
  // Development
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  
  // Your CURRENT Render domain
  'https://blog-backend-6-k4g8.onrender.com',
  
  // Your frontend when deployed
  // 'https://your-actual-frontend.com'
];

console.log('🌐 CORS Allowed Origins:', allowedOrigins);

// Apply CORS
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      console.log(`✅ CORS allowed: ${origin}`);
      return callback(null, true);
    } else {
      console.log(`🚫 CORS blocked: ${origin}`);
      return callback(new Error('CORS not allowed'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});
// ==================== END CORS ====================

app.use(helmet())
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true, limit: "10mb" }))

const port = process.env.PORT || 3000

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 50 : 100,
  message: { success: false, error: 'Too many requests' }
})
app.use('/askAi', limiter)

// Initialize Cerebras
let client
if (process.env.CEREBRAS_API_KEY) {
  client = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY })
  console.log('✅ Cerebras client initialized')
} else {
  console.warn('⚠️ No Cerebras API key - running in test mode')
}

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'blog-backend-api',
    environment: isProduction ? 'production' : 'development',
    cors_allowed_origins: allowedOrigins,
    current_domain: 'https://blog-backend-6-k4g8.onrender.com'
  })
})

app.get('/', (req, res) => {
  res.json({
    message: 'Blog Backend API',
    version: '2.0.0',
    domain: 'https://blog-backend-6-k4g8.onrender.com',
    cors_enabled_for: allowedOrigins
  })
})

// AI endpoint
app.post('/askAi', async (req, res) => {
  try {
    console.log(`🤖 Request from: ${req.headers.origin || 'unknown'}`)
    
    if (!client) {
      // Test mode - return mock response
      const { message } = req.body
      return res.json({
        success: true,
        data: {
          text: `Mock AI Response for: "${message}"\n\nThis is a test response. When Cerebras API key is configured, real AI responses will be returned.\n\nImage suggestions: Use relevant stock photos related to ${message}.`
        },
        meta: { model: 'test-mode', tokens: 42 }
      })
    }

    const { message } = req.body
    
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Message is required"
      })
    }

    console.log(`Processing: ${message.substring(0, 100)}...`)

    const chatCompletion = await client.chat.completions.create({
      messages: [{ role: 'user', content: message }],
      model: 'llama3.1-8b',
      max_tokens: 1000,
      temperature: 0.7,
    })

    const text = chatCompletion?.choices[0]?.message?.content
    
    if (!text) {
      throw new Error('No response from AI model')
    }

    console.log(`✅ Response generated (${text.length} chars)`)
    
    res.json({
      success: true,
      data: { text },
      meta: {
        model: 'llama3.1-8b',
        tokens: chatCompletion?.usage?.total_tokens
      }
    })

  } catch (error) {
    console.error('❌ AI Error:', error.message)
    res.status(500).json({
      success: false,
      error: "AI service error",
      details: !isProduction ? error.message : undefined
    })
  }
})

// Test CORS endpoint
app.get('/test-cors', (req, res) => {
  res.json({
    success: true,
    message: 'CORS is working!',
    your_origin: req.headers.origin,
    allowed: allowedOrigins.includes(req.headers.origin || ''),
    allowed_origins: allowedOrigins
  })
})

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`)
  console.log(`🌐 Allowed CORS origins:`, allowedOrigins)
  console.log(`🔗 Health: https://blog-backend-6-k4g8.onrender.com/health`)
  console.log(`🔗 Test CORS: https://blog-backend-6-k4g8.onrender.com/test-cors`)
})