const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
const axios = require("axios");
const { twiml: { VoiceResponse } } = require("twilio");

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(bodyParser.urlencoded({ extended: false }));
app.use("/public", express.static(path.join(__dirname, "public")));

app.post("/voice", async (req, res) => {
  const response = new VoiceResponse();

  const speech = req.body.SpeechResult || "";

  if (speech.toLowerCase().includes("non")) {
    response.say({ voice: "Polly.Celine", language: "fr-FR" }, "Très bien, je vous souhaite une excellente journée. Au revoir !");
    response.hangup();
    return res.type("text/xml").send(response.toString());
  }

  let text = "Bonjour, je suis l’assistante de Monsieur Aliwa, expert en intelligence artificielle. Comment puis-je vous aider ?";
  if (speech) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "Tu es l’assistante virtuelle professionnelle de Monsieur Aliwa, spécialisée en intelligence artificielle. Sois polie, douce, utile et concise." },
          { role: "user", content: speech }
        ]
      });

      text = "Un instant... " + completion.choices[0].message.content;
    } catch (err) {
      text = "Je suis désolée, une erreur est survenue.";
      console.error("Erreur OpenAI :", err.message);
    }
  }

  try {
    const audio = await axios({
      method: "POST",
      url: "https://api.elevenlabs.io/v1/text-to-speech/" + process.env.ELEVEN_VOICE_ID,
      headers: {
        "xi-api-key": process.env.ELEVEN_API_KEY,
        "Content-Type": "application/json"
      },
      data: {
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      },
      responseType: "arraybuffer"
    });

    const filePath = path.join(__dirname, "public", "response.mp3");
    fs.writeFileSync(filePath, audio.data);

    response.play({}, `${process.env.BASE_URL}/public/response.mp3`);
    response.gather({
      input: "speech",
      action: "/voice",
      method: "POST",
      timeout: 10
    });
  } catch (err) {
    console.error("Erreur ElevenLabs :", err.message);
    response.say({ voice: "Polly.Celine", language: "fr-FR" }, "Je suis désolée, une erreur est survenue.");
  }

  res.type("text/xml");
  res.send(response.toString());
});

app.listen(port, () => {
  console.log(`Serveur actif sur le port ${port}`);
});
