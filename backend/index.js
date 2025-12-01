import express from "express"
import cors from "cors"
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import dotenv from "dotenv"
import helmet from "helmet"
import rateLimit from "express-rate-limit"

dotenv.config()

const app = express()

// Determine environment
const isProduction = process.env.NODE_ENV === 'production'

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" }
}))

// Production CORS configuration
const allowedOrigins = []

// Add production domains - REPLACE THESE WITH YOUR ACTUAL DOMAINS
if (isProduction) {
  allowedOrigins.push(
    'https://your-frontend-domain.com',  // Your production frontend
    'https://www.your-frontend-domain.com'  // With www
  )
  console.log('🔒 Production mode - CORS restricted to production domains')
} else {
  // Development - allow localhost
  allowedOrigins.push(
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:5174'
  )
  console.log('🚀 Development mode - CORS allows localhost')
}

// Add Railway domain for testing
allowedOrigins.push('https://blogbackend-production-7dfc.up.railway.app')

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      // Log unauthorized origins
      console.warn(`🚫 CORS blocked request from origin: ${origin}`);
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    
    console.log(`✅ CORS allowed request from origin: ${origin}`);
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length'],
  maxAge: 86400,  // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 204
}

app.use(cors(corsOptions));

// Handle preflight requests for all routes
app.options('*', cors(corsOptions));

// Body parser middleware
app.use(express.json({
  limit: "10mb"
}));

app.use(express.urlencoded({
  extended: true,
  limit: "10mb"
}));

const port = process.env.PORT || 3000;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 50 : 100, // More lenient in development
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/askAi', limiter);

// Validate API key is set
if (!process.env.CEREBRAS_API_KEY) {
  console.error('❌ FATAL: CEREBRAS_API_KEY environment variable is not set');
  
  if (isProduction) {
    process.exit(1);
  } else {
    console.warn('⚠️  Development mode: Running without Cerebras API key');
  }
}

let client;
if (process.env.CEREBRAS_API_KEY) {
  client = new Cerebras({
    apiKey: process.env.CEREBRAS_API_KEY
  });
  console.log('✅ Cerebras client initialized');
} else {
  console.warn('⚠️  Cerebras client not initialized - no API key');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'blog-backend-api',
    environment: isProduction ? 'production' : 'development',
    cors_allowed_origins: allowedOrigins
  });
});

app.get("/", (req, res) => {
  res.json({
    status: "Server is running",
    message: "Blog Backend API",
    version: "1.0.0",
    environment: isProduction ? 'production' : 'development',
    endpoints: {
      health: "GET /health",
      askAi: "POST /askAi"
    },
    cors: {
      allowed_origins: allowedOrigins,
      note: isProduction ? 'Production mode - restricted domains' : 'Development mode - includes localhost'
    }
  });
});

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// AI endpoint
app.post('/askAi', async (req, res) => {
  try {
    // Check if client is initialized
    if (!client) {
      return res.status(500).json({
        success: false,
        error: "AI service is not configured",
        details: isProduction ? undefined : "CEREBRAS_API_KEY environment variable is not set"
      });
    }

    const { message } = req.body;
    
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Message is required and must be a non-empty string"
      });
    }

    // Limit message length
    if (message.length > 5000) {
      return res.status(400).json({
        success: false,
        error: "Message too long. Maximum 5000 characters."
      });
    }

    console.log(`🤖 Processing AI request: ${message.substring(0, 100)}...`);

    const chatCompletion = await client.chat.completions.create({
      messages: [{ role: 'user', content: message }],
      model: 'llama3.1-8b',
      max_tokens: 1500,
      temperature: 0.7,
    });

    const text = chatCompletion?.choices[0]?.message?.content;
    
    if (!text) {
      throw new Error('No response from AI model');
    }

    console.log(`✅ AI response generated (${text.length} characters)`);

    res.json({
      success: true,
      data: {
        text: text
      },
      meta: {
        model: 'llama3.1-8b',
        tokens: chatCompletion?.usage?.total_tokens
      }
    });

  } catch (error) {
    console.error("❌ Cerebras API Error:", error);
    
    // Handle specific Cerebras API errors
    if (error.status === 401) {
      return res.status(401).json({
        success: false,
        error: "Invalid API key"
      });
    }
    
    if (error.status === 429) {
      return res.status(429).json({
        success: false,
        error: "Rate limit exceeded. Please try again later."
      });
    }
    
    res.status(500).json({
      success: false,
      error: "Failed to get response from AI",
      details: !isProduction ? error.message : undefined
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('🔥 Error:', err);
  
  if (err.name === 'CorsError') {
    return res.status(403).json({
      success: false,
      error: 'CORS Error',
      message: 'Not allowed by CORS policy',
      allowed_origins: allowedOrigins
    });
  }
  
  res.status(err.status || 500).json({
    success: false,
    error: 'Internal Server Error',
    message: isProduction ? 'Something went wrong' : err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📡 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log(`🌐 Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`🔗 Health check: http://localhost:${port}/health`);
  console.log(`🤖 AI endpoint: http://localhost:${port}/askAi`);
});