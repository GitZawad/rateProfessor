import { NextResponse } from "next/server";
import axios from 'axios';
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

const systemPrompt = `
System Role: You are a helpful and knowledgeable "Rate My Professor" assistant. Your task is to assist students in finding professors based on their specific queries. For each user query, you will analyze the request, retrieve relevant professor information using Retrieval-Augmented Generation (RAG), and present the top 3 professors that best match the query.

How You Operate:
Query Understanding:

Interpret the student's query to understand their specific needs, which could include subject expertise, teaching style, student reviews, ratings, or any other relevant criteria.
Retrieval and Generation:

Use RAG to retrieve relevant data about professors from the database. This includes details like subject taught, average rating, student reviews, and any other metadata available.
Rank the professors based on their relevance to the query, focusing on providing the most helpful and accurate recommendations.
Response Formatting:

Present the top 3 professors in a clear and concise manner.
For each professor, include their name, the subject they teach, their overall rating, a brief summary of student reviews, and any notable strengths or unique aspects.
If the student's query is unclear or too broad, ask follow-up questions to better understand their needs.
Example Query:
Student Query: "I'm looking for a great Calculus professor who is known for being helpful and approachable."

Response:

Professor Jane Doe
Subject: Calculus
Rating: 4.8/5
Student Reviews: "Extremely helpful and always willing to answer questions. Her office hours are invaluable."
Professor John Smith
Subject: Calculus
Rating: 4.6/5
Student Reviews: "Great at breaking down complex topics. Very approachable and supportive."
Professor Emily Zhang
Subject: Calculus
Rating: 4.5/5
Student Reviews: "Patient and thorough in her explanations. Students appreciate her teaching style."
Additional Considerations:
Always ensure that the responses are personalized based on the query.
Strive for accuracy and relevance in your recommendations.
If no professors match the query, offer alternative suggestions or inform the student politely.
`;

export async function POST(req) {
  const data = await req.json();
  const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });
  const index = pc.index('rag').namespace('ns1');
  const openai = new OpenAI();

  // Create a retry instance with maximum retries, delay, and increased timeout
  const retry = axios.create({
    retryDelay: 2000, // 2 seconds delay between retries
    maxRetries: 3, // Maximum number of retries
    timeout: 30000 // Increased timeout to 30 seconds
  });

  try {
    const text = data[data.length - 1].content;
    console.log("Sending request to OpenAI API at:", new Date()); // Log request timestamp

    const embedding = await retry.post('https://api.openai.com/v1/embeddings', {
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float',
    }, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    });

    const results = await index.query({
      topK: 3,
      includeMetadata: true,
      vector: embedding.data[0].embedding
    });

    let resultString = '\n\nReturned results from vector db (done automatically): ';
    results.matches.forEach((match) => {
      resultString += `\n
      Professor: ${match.id}
      Review: ${match.metadata.stars}
      Subject: ${match.metadata.subject}
      Stars ${match.metadata.stars}
      \n\n
      `;
    });

    const lastmessage = data[data.length - 1];
    const lastmessageContent = lastmessage.content + resultString;
    const lastDataWithoutLastMessage = data.slice(0, data.length - 1);

    const completion = await openai.chat.completions.create({
      messages: [
        {role: 'system', content: systemPrompt},
        ...lastDataWithoutLastMessage,
        {role: 'user', content: lastmessageContent},
      ],
      model: 'gpt-4o-mini',
      stream: true,
    });

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              const text = encoder.encode(content);
              controller.enqueue(text);
            }
          }
        } catch (err) {
          controller.error(err);
          console.error("Error:", err); // Log the error for debugging
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(stream);
  } catch (error) {
    console.error("Error:", error); // Log the error for debugging
    console.error("Error message:", error.message);
    console.error("Error code:", error.code);
    console.error("Error response:", error.response);

    // Provide a fallback response if the request fails after multiple retries
    return new NextResponse("An error occurred. Please try again later.", { status: 500 });
  }
}