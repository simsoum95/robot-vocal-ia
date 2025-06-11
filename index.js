const express = require("express");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const twilio = require("twilio");
const nodemailer = require("nodemailer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configuration email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.use(bodyParser.urlencoded({ extended: false }));
app.use('/audio', express.static('audio')); // Serve audio files

// Ensure audio directory exists
if (!fs.existsSync('audio')) {
  fs.mkdirSync('audio');
}

// Function to generate speech with ElevenLabs
async function generateSpeech(text, filename) {
  try {
    const response = await axios({
      method: 'post',
      url: `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`,
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      data: {
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true
        }
      },
      responseType: 'arraybuffer'
    });

    const audioPath = path.join('audio', `${filename}.mp3`);
    fs.writeFileSync(audioPath, response.data);
    return audioPath;
  } catch (error) {
    console.error('Error generating speech:', error);
    return null;
  }
}

// Function to create TwiML with ElevenLabs audio
async function createTwiMLWithSpeech(text, gatherOptions = null) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  
  // Generate unique filename
  const filename = `speech_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const audioPath = await generateSpeech(text, filename);
  
  if (audioPath && gatherOptions) {
    const gather = twiml.gather(gatherOptions);
    gather.play(`${process.env.BASE_URL || 'https://your-app-url.com'}/audio/${filename}.mp3`);
  } else if (audioPath) {
    twiml.play(`${process.env.BASE_URL || 'https://your-app-url.com'}/audio/${filename}.mp3`);
  } else {
    // Fallback to Twilio's TTS if ElevenLabs fails
    if (gatherOptions) {
      const gather = twiml.gather(gatherOptions);
      gather.say({ voice: "Polly.Celine", language: "fr-FR" }, text);
    } else {
      twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, text);
    }
  }
  
  return twiml;
}

// Fonction pour vérifier les horaires d'ouverture
function isBusinessHours() {
  const now = new Date();
  const day = now.getDay(); // 0 = Dimanche, 1 = Lundi, etc.
  const hour = now.getHours();
  
  // Dimanche à Jeudi (0,1-4): 9h-18h
  if ((day === 0) || (day >= 1 && day <= 4)) {
    return hour >= 9 && hour < 18;
  }
  // Vendredi et Samedi fermé
  return false;
}

// Fonction pour envoyer un email
async function sendEmail(subject, message, senderInfo = '') {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: 'simonhaliwa@gmail.com',
      subject: `Dream Team - ${subject}`,
      text: `${message}\n\n${senderInfo}`
    };
    
    await transporter.sendMail(mailOptions);
    console.log('Email envoyé avec succès');
    return true;
  } catch (error) {
    console.error('Erreur envoi email:', error);
    return false;
  }
}

// Fonction pour détecter si l'appelant veut terminer l'appel
function wantsToEndCall(speech) {
  const endCallPhrases = [
    "terminer l'appel",
    "raccrocher",
    "c'est tout",
    "ça sera tout",
    "vous pouvez raccrocher",
    "fin de l'appel",
    "au revoir",
    "bonne journée",
    "merci c'est tout",
    "j'ai terminé",
    "plus rien",
    "rien d'autre",
    "c'est bon",
    "merci au revoir"
  ];
  
  const lowerSpeech = speech.toLowerCase();
  return endCallPhrases.some(phrase => lowerSpeech.includes(phrase));
}

// Fonction améliorée pour analyser l'intention avec plus de contexte
async function analyzeIntent(userSpeech, conversationHistory = '') {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini-2024-07-18",
      messages: [
        { 
          role: "system", 
          content: `Tu es un analyseur d'intentions pour un standard téléphonique professionnel. 

CONTEXTE: Dream Team est une entreprise. L'appelant peut avoir différentes demandes.

INSTRUCTIONS:
- Analyse le message de l'appelant avec le contexte de la conversation
- Sois flexible et compréhensif avec les variations de langage naturel
- Réponds UNIQUEMENT par l'un de ces mots-clés:

HORAIRES: Si la personne demande les horaires d'ouverture, heures d'ouverture, quand vous êtes ouverts, etc.
Exemples: "quels sont vos horaires", "vous êtes ouverts quand", "à quelle heure vous fermez"

RENDEZ_VOUS: Si la personne veut prendre rendez-vous, un appointment, voir quelqu'un, planifier une rencontre
Exemples: "je veux un rendez-vous", "prendre rendez-vous", "voir monsieur haliwa", "planifier une rencontre"

PROBLEME: Si la personne mentionne un problème, une question, une réclamation, quelque chose qui ne va pas
Exemples: "j'ai un problème", "il y a un souci", "je veux me plaindre", "ça ne marche pas"

TRANSFERT: Si la personne demande explicitement à parler à quelqu'un, être transférée, joindre la direction
Exemples: "je veux parler à monsieur haliwa", "transférez-moi", "passez-moi la direction"

EMAIL: Si la personne veut envoyer un message, laisser un message, communiquer par écrit
Exemples: "envoyez un email", "laissez un message", "notez que", "transmettez que"

AUTRE: Pour les salutations simples, remerciements, ou demandes peu claires

IMPORTANT: 
- Ne sois pas trop strict sur les mots exacts
- Comprends l'intention générale même si c'est dit différemment
- Le mot "non" seul n'est PAS une fin d'appel
- Utilise le contexte de conversation pour mieux comprendre`
        },
        { role: "user", content: `Message actuel: "${userSpeech}"\n\nContexte conversation: ${conversationHistory}` }
      ],
      temperature: 0.1
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Erreur analyse intention:', error);
    return 'AUTRE';
  }
}

let conversationContext = {};

app.post("/voice", async (req, res) => {
  const callSid = req.body.CallSid;
  
  // Initialiser le contexte de conversation
  if (!conversationContext[callSid]) {
    conversationContext[callSid] = {
      history: [],
      step: 'initial',
      attempts: 0
    };
  }

  // Vérifier les horaires d'ouverture
  if (!isBusinessHours()) {
    const gatherOptions = {
      input: "speech",
      speechTimeout: "auto",
      action: "/process-after-hours",
      method: "POST",
      language: "fr-FR"
    };

    const text = "Bonjour, vous êtes bien chez Dream Team. Vous appelez en dehors de nos horaires d'ouverture. Nous sommes ouverts du dimanche au jeudi de 9 heures à 18 heures. Vous pouvez laisser un message vocal, il sera transmis à Monsieur Haliwa par email.";
    const twiml = await createTwiMLWithSpeech(text, gatherOptions);
    
    res.type("text/xml");
    res.send(twiml.toString());
  } else {
    const gatherOptions = {
      input: "speech",
      speechTimeout: "auto",
      action: "/process",
      method: "POST",
      language: "fr-FR"
    };

    const text = "Bonjour, vous êtes bien chez Dream Team, comment puis-je vous aider ?";
    const twiml = await createTwiMLWithSpeech(text, gatherOptions);
    
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

app.post("/process-after-hours", async (req, res) => {
  const userSpeech = req.body.SpeechResult;

  if (!userSpeech) {
    const text = "Désolée, je n'ai pas compris votre message. Au revoir.";
    const twiml = await createTwiMLWithSpeech(text);
    twiml.hangup();
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  // Envoyer le message vocal par email
  const emailSent = await sendEmail(
    "Message vocal hors horaires",
    `Message vocal reçu en dehors des horaires d'ouverture:\n\n"${userSpeech}"`,
    `Reçu le: ${new Date().toLocaleString('fr-FR')}`
  );

  let text;
  if (emailSent) {
    text = "Merci, votre message a été transmis à Monsieur Haliwa. Il vous recontactera dès que possible. Bonne journée.";
  } else {
    text = "Désolée, une erreur est survenue. Veuillez rappeler plus tard. Au revoir.";
  }

  const twiml = await createTwiMLWithSpeech(text);
  twiml.hangup();
  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/process", async (req, res) => {
  const userSpeech = req.body.SpeechResult;
  const callSid = req.body.CallSid;

  // Initialiser le contexte si nécessaire
  if (!conversationContext[callSid]) {
    conversationContext[callSid] = {
      history: [],
      step: 'initial',
      attempts: 0
    };
  }

  if (!userSpeech) {
    conversationContext[callSid].attempts++;
    
    // Après 2 tentatives sans réponse, proposer le transfert
    if (conversationContext[callSid].attempts >= 2) {
      const text = "Je n'arrive pas à vous entendre clairement. Souhaitez-vous que je vous transfère à Monsieur Haliwa ?";
      const gatherOptions = {
        input: "speech",
        speechTimeout: "auto",
        action: "/process",
        method: "POST",
        language: "fr-FR"
      };
      const twiml = await createTwiMLWithSpeech(text, gatherOptions);
      res.type("text/xml");
      return res.send(twiml.toString());
    }

    const gatherOptions = {
      input: "speech",
      speechTimeout: "auto",
      action: "/process",
      method: "POST",
      language: "fr-FR"
    };

    const text = "Je vous écoute, pouvez-vous répéter s'il vous plaît ?";
    const twiml = await createTwiMLWithSpeech(text, gatherOptions);
    
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  // Réinitialiser le compteur d'échecs
  conversationContext[callSid].attempts = 0;
  
  // Ajouter à l'historique
  conversationContext[callSid].history.push(userSpeech);

  // Vérifier si l'appelant veut terminer l'appel
  if (wantsToEndCall(userSpeech)) {
    const text = "Très bien, bonne journée et merci d'avoir appelé Dream Team.";
    const twiml = await createTwiMLWithSpeech(text);
    twiml.hangup();
    delete conversationContext[callSid];
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  try {
    // Construire l'historique de conversation pour le contexte
    const conversationHistory = conversationContext[callSid].history.slice(-3).join(' | ');
    
    // Analyser l'intention avec le contexte
    const intention = await analyzeIntent(userSpeech, conversationHistory);
    
    console.log(`Intention détectée: ${intention} pour "${userSpeech}"`);
    
    let twiml;

    if (intention === "HORAIRES") {
      // Répondre directement aux horaires
      const gatherOptions = {
        input: "speech",
        speechTimeout: "auto",
        action: "/process",
        method: "POST",
        language: "fr-FR"
      };

      const text = "Nous sommes ouverts du dimanche au jeudi, de 9 heures à 18 heures. Souhaitez-vous recevoir ces informations par email également ?";
      twiml = await createTwiMLWithSpeech(text, gatherOptions);
      conversationContext[callSid].step = "waiting_email_confirmation";
      conversationContext[callSid].lastAction = "horaires";

    } else if (intention === "TRANSFERT") {
      // Transfert direct
      const text = "Je vous transfère à Monsieur Haliwa. Veuillez patienter.";
      twiml = await createTwiMLWithSpeech(text);
      twiml.dial("+972584469947");
      delete conversationContext[callSid];

    } else if (intention === "RENDEZ_VOUS") {
      // Gestion des rendez-vous
      const gatherOptions = {
        input: "speech",
        speechTimeout: "auto",
        action: "/process",
        method: "POST",
        language: "fr-FR"
      };

      const text = "Très bien, pour votre rendez-vous. Préférez-vous que je vous transfère directement à Monsieur Haliwa, ou que je transmette votre demande par email ?";
      twiml = await createTwiMLWithSpeech(text, gatherOptions);
      conversationContext[callSid].step = "rdv_choice";
      conversationContext[callSid].originalMessage = userSpeech;

    } else if (intention === "PROBLEME") {
      // Gestion des problèmes
      const gatherOptions = {
        input: "speech",
        speechTimeout: "auto",
        action: "/process",
        method: "POST",
        language: "fr-FR"
      };

      const text = "Je comprends que vous avez un problème. Préférez-vous que je vous transfère à Monsieur Haliwa pour en discuter directement, ou que je transmette votre message par email ?";
      twiml = await createTwiMLWithSpeech(text, gatherOptions);
      conversationContext[callSid].step = "problem_choice";
      conversationContext[callSid].originalMessage = userSpeech;

    } else if (intention === "EMAIL") {
      // Demande directe d'email
      const gatherOptions = {
        input: "speech",
        speechTimeout: "auto",
        action: "/process",
        method: "POST",
        language: "fr-FR"
      };

      const text = "Parfait, je vais noter votre message pour l'envoyer par email. Que souhaitez-vous transmettre exactement ?";
      twiml = await createTwiMLWithSpeech(text, gatherOptions);
      conversationContext[callSid].step = "get_email_message";
      conversationContext[callSid].originalMessage = userSpeech;

    } else {
      // Gestion des étapes de conversation en cours
      if (conversationContext[callSid].step === "waiting_email_confirmation") {
        if (userSpeech.toLowerCase().includes("oui") || userSpeech.toLowerCase().includes("email")) {
          // Envoyer les horaires par email
          const emailSent = await sendEmail(
            "Horaires d'ouverture",
            `Voici nos horaires d'ouverture :\n\nDu dimanche au jeudi : 9h00 - 18h00\nVendredi et samedi : Fermé\n\nPour toute question, n'hésitez pas à nous contacter.`,
            `Demandé le: ${new Date().toLocaleString('fr-FR')}`
          );

          const gatherOptions = {
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          };

          let text;
          if (emailSent) {
            text = "Parfait, les horaires vous ont été envoyés par email. Y a-t-il autre chose pour laquelle je peux vous aider ?";
          } else {
            text = "Désolée, une erreur est survenue pour l'email. Y a-t-il autre chose pour laquelle je peux vous aider ?";
          }
          twiml = await createTwiMLWithSpeech(text, gatherOptions);
          conversationContext[callSid].step = "general";
        } else {
          // Pas d'email souhaité
          const gatherOptions = {
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          };

          const text = "Très bien. Y a-t-il autre chose pour laquelle je peux vous aider ?";
          twiml = await createTwiMLWithSpeech(text, gatherOptions);
          conversationContext[callSid].step = "general";
        }

      } else if (conversationContext[callSid].step === "rdv_choice") {
        if (userSpeech.toLowerCase().includes("transf") || userSpeech.toLowerCase().includes("parler") || userSpeech.toLowerCase().includes("direct")) {
          // Transférer
          const text = "Je vous transfère à Monsieur Haliwa. Veuillez patienter.";
          twiml = await createTwiMLWithSpeech(text);
          twiml.dial("+972584469947");
          delete conversationContext[callSid];
        } else {
          // Email pour rendez-vous
          const gatherOptions = {
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          };

          const text = "D'accord, je vais transmettre votre demande de rendez-vous par email. Pouvez-vous me donner plus de détails sur ce rendez-vous ?";
          twiml = await createTwiMLWithSpeech(text, gatherOptions);
          conversationContext[callSid].step = "get_rdv_details";
        }

      } else if (conversationContext[callSid].step === "get_rdv_details") {
        // Envoyer la demande de rendez-vous
        const emailSent = await sendEmail(
          "Demande de rendez-vous",
          `Nouvelle demande de rendez-vous :\n\nDemande initiale : "${conversationContext[callSid].originalMessage}"\n\nDétails : "${userSpeech}"`,
          `Reçu le: ${new Date().toLocaleString('fr-FR')}`
        );

        const gatherOptions = {
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR"
        };

        let text;
        if (emailSent) {
          text = "Parfait, votre demande de rendez-vous a été transmise à Monsieur Haliwa. Il vous recontactera rapidement. Y a-t-il autre chose pour laquelle je peux vous aider ?";
        } else {
          text = "Désolée, une erreur est survenue. Veuillez rappeler plus tard. Y a-t-il autre chose que je puisse faire pour vous ?";
        }
        twiml = await createTwiMLWithSpeech(text, gatherOptions);
        conversationContext[callSid].step = "general";

      } else if (conversationContext[callSid].step === "problem_choice") {
        if (userSpeech.toLowerCase().includes("transf") || userSpeech.toLowerCase().includes("parler") || userSpeech.toLowerCase().includes("direct")) {
          // Transférer
          const text = "Je vous transfère à Monsieur Haliwa. Veuillez patienter.";
          twiml = await createTwiMLWithSpeech(text);
          twiml.dial("+972584469947");
          delete conversationContext[callSid];
        } else {
          // Email pour problème
          const gatherOptions = {
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          };

          const text = "D'accord, je vais transmettre votre message par email. Pouvez-vous me donner plus de détails sur votre problème ?";
          twiml = await createTwiMLWithSpeech(text, gatherOptions);
          conversationContext[callSid].step = "get_problem_details";
        }

      } else if (conversationContext[callSid].step === "get_problem_details") {
        // Envoyer le problème
        const emailSent = await sendEmail(
          "Problème client",
          `Problème signalé par un client :\n\nProblème initial : "${conversationContext[callSid].originalMessage}"\n\nDétails : "${userSpeech}"`,
          `Reçu le: ${new Date().toLocaleString('fr-FR')}`
        );

        const gatherOptions = {
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR"
        };

        let text;
        if (emailSent) {
          text = "Merci, votre message a été transmis à la direction. Vous recevrez une réponse rapidement. Y a-t-il autre chose pour laquelle je peux vous aider ?";
        } else {
          text = "Désolée, une erreur est survenue. Veuillez rappeler plus tard. Y a-t-il autre chose que je puisse faire pour vous ?";
        }
        twiml = await createTwiMLWithSpeech(text, gatherOptions);
        conversationContext[callSid].step = "general";

      } else if (conversationContext[callSid].step === "get_email_message") {
        // Envoyer le message général
        const emailSent = await sendEmail(
          "Message client",
          `Message reçu d'un client :\n\n"${userSpeech}"`,
          `Reçu le: ${new Date().toLocaleString('fr-FR')}`
        );

        const gatherOptions = {
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR"
        };

        let text;
        if (emailSent) {
          text = "Parfait, votre message a été transmis. Y a-t-il autre chose pour laquelle je peux vous aider ?";
        } else {
          text = "Désolée, une erreur est survenue. Y a-t-il autre chose que je puisse faire pour vous ?";
        }
        twiml = await createTwiMLWithSpeech(text, gatherOptions);
        conversationContext[callSid].step = "general";

      } else {
        // Cas général - proposer les options principales
        const gatherOptions = {
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR"
        };

        const text = "Je peux vous aider avec nos horaires d'ouverture, prendre un rendez-vous, ou transmettre un message. Que souhaitez-vous ?";
        twiml = await createTwiMLWithSpeech(text, gatherOptions);
        conversationContext[callSid].step = "general";
      }
    }

    res.type("text/xml");
    res.send(twiml.toString());

  } catch (error) {
    console.error("Erreur traitement:", error);
    
    const gatherOptions = {
      input: "speech",
      speechTimeout: "auto",
      action: "/process",
      method: "POST",
      language: "fr-FR"
    };

    const text = "Une erreur technique est survenue. Souhaitez-vous que je vous transfère à Monsieur Haliwa ?";
    const twiml = await createTwiMLWithSpeech(text, gatherOptions);
    
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

app.listen(port, () => {
  console.log(`Standard téléphonique Dream Team actif sur le port ${port}`);
});