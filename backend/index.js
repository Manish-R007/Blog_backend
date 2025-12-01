import express from "express"
import cors from "cors"
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import dotenv from "dotenv"
import conf from "../src/conf/conf.js";

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json({
  limit: "16kb"
}))

const port = process.env.PORT || 3000
const apikey = conf.aiblogeneratorkey || ""
console.log(apikey);


app.get("/", (req, res) => {
  res.send("Hello")
})


const client = new Cerebras({
  apiKey: "csk_32mr35enf4wcfmch99t63vw64kjmf6fm48nwd6wptt3h8953" 
});

app.post('/askAi', async (req, res) => {
  try {
    const { message } = req.body
    
    if (!message) {
      return res.status(400).json({
        error: "Message is required"
      })
    }


    const chatCompletion = await client.chat.completions.create({
      messages: [{ role: 'user', content: message }],
      model: 'llama3.1-8b',
    })

    const text = chatCompletion?.choices[0]?.message?.content
    
    // console.log("AI Response:", text)

  
    res.json({
      success: true,
      data: {
        text:text
      }
    })

  } catch (error) {
    // console.error("Error calling Cerebras API:", error)
    
    res.status(500).json({
      success: false,
      error: "Failed to get response from AI",
      details: error.message
    })
  }
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})