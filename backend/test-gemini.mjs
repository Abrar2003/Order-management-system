import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const client = new GoogleGenAI({});

try {
  const interaction = await client.interactions.create({
    model: "gemini-3.7-flash",

    input: `
You are an OMS operations analyst.

Suppose:
Vendor: Boranada
Ready CBM: 43
Container target: 65
Expected additional CBM:
- September 3: 8 CBM
- September 7: 15 CBM

When is the vendor likely to have enough CBM?
Explain briefly.
`,

    generation_config: {
      thinking_level: "high",
    },

    store: false,
  });

  console.log(interaction.output_text);
} catch (error) {
  console.error(error);
}