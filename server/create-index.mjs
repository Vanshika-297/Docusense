import { Pinecone } from "@pinecone-database/pinecone";

const apiKey = process.env.PINECONE_API_KEY;
const indexName = process.env.PINECONE_INDEX || "docusense-v1";

if (!apiKey) {
  console.error("Missing PINECONE_API_KEY in environment.");
  process.exit(1);
}

const pc = new Pinecone({ apiKey });

try {
  const list = await pc.listIndexes();
  const existing = (list.indexes || []).find((idx) => idx.name === indexName);

  if (existing) {
    console.log(`Index "${indexName}" already exists with dimension ${existing.dimension}.`);
  } else {
    console.log(`Creating index "${indexName}" with dimension 3072...`);
    await pc.createIndex({
      name: indexName,
      dimension: 3072,
      metric: "cosine",
      spec: {
        serverless: {
          cloud: "aws",
          region: "us-east-1",
        },
      },
    });
    console.log(`Index "${indexName}" created successfully!`);
  }
} catch (err) {
  console.error("Error creating/checking index:", err);
  process.exit(1);
}
