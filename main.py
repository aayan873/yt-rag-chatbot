from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from youtube_transcript_api import YouTubeTranscriptApi
from langchain.schema import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from huggingface_hub import InferenceClient
import openai
import os
from pydantic import BaseModel, validator
from collections import OrderedDict
import os
import re

app = FastAPI(title="YouTube RAG Chatbot API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

HF_TOKEN = os.getenv("HF_TOKEN")

if not HF_TOKEN:
    raise RuntimeError("HF_TOKEN environment variable not set")
openai.api_key = HF_TOKEN
openai.api_base = "https://router.huggingface.co/v1"

hf_client = InferenceClient(
    model="sentence-transformers/all-MiniLM-L6-v2",
    token=HF_TOKEN
)

class LRUCache(OrderedDict):
    def __init__(self, maxsize=50):
        self.maxsize = maxsize
        super().__init__()
    def __getitem__(self, key):
        value = super().__getitem__(key)
        self.move_to_end(key)
        return value
    def __setitem__(self, key, value):
        if key in self:
            self.move_to_end(key)
        elif len(self) >= self.maxsize:
            oldest = next(iter(self))
            del self[oldest]
        super().__setitem__(key, value)

vectorstore_cache = LRUCache(maxsize=50)

class AskRequest(BaseModel):
    video_id: str
    question: str
    @validator('video_id')
    def validate_video_id(cls, v):
        if not re.match(r'^[a-zA-Z0-9_-]{11}$', v):
            raise ValueError('Invalid YouTube video ID format')
        return v
    @validator('question')
    def validate_question(cls, v):
        if not v.strip() or len(v) > 500:
            raise ValueError('Question must be 1-500 characters')
        return v.strip()

def get_transcript(video_id):
    ytt_api = YouTubeTranscriptApi()
    fetched_transcript = ytt_api.fetch(video_id)
    transcript_obj = []
    for snippet in fetched_transcript:
        transcript_obj.append({
            'text': snippet.text,
            'start': snippet.start,
            'duration': snippet.duration
        })
    return transcript_obj

def transcript_to_docs(transcript):
    docs = [
        Document(
            page_content=t["text"],
            metadata={"start": t["start"], "end": t.get("start", 0) + t.get("duration", 0)}
        )
        for t in transcript
    ]
    splitter = RecursiveCharacterTextSplitter(chunk_size=300, chunk_overlap=50)
    return splitter.split_documents(docs)

def build_vectorstore(docs):
    class HFEmbeddings:
        def __call__(self, text):
            e = hf_client.feature_extraction(text)
            return e.tolist() if hasattr(e,"tolist") else list(e)
        
        def embed_documents(self, texts):
            all_emb = []
            for t in texts:
                e = hf_client.feature_extraction(t)
                all_emb.append(e.tolist() if hasattr(e,"tolist") else list(e))
            return all_emb
        
        def embed_query(self, text):
            e = hf_client.feature_extraction(text)
            return e.tolist() if hasattr(e,"tolist") else list(e)
    
    embeddings = HFEmbeddings()
    return FAISS.from_documents(docs, embeddings)

def ask_question(question, vectorstore, k=3):
    retriever = vectorstore.as_retriever(search_kwargs={"k": k})
    docs = retriever.invoke(question)
    if not docs:
        return {"answer": "No relevant context found.", "sources": []}
    context_parts = []
    for d in docs:
        start, end = d.metadata.get("start"), d.metadata.get("end")
        tag = f"[{start:.2f}s-{end:.2f}s]" if start and end else ""
        context_parts.append(f"{tag} {d.page_content}")
    context = "\n".join(context_parts)
    messages = [
        {"role": "system", "content": "You answer questions based on the context."},
        {"role": "user", "content": f"Question: {question}\nContext:\n{context}"}
    ]
    completion = openai.ChatCompletion.create(
    model="deepseek-ai/DeepSeek-V3.1:together",
    messages=messages
    )
    answer = completion.choices[0].message.content
    sources = [{"text": d.page_content, "start": d.metadata.get("start"), "end": d.metadata.get("end")} for d in docs]
    return {"answer": answer, "sources": sources}

@app.get("/")
def read_root():
    return {"message": "YouTube RAG Chatbot API", "version": "1.0.0"}

@app.post("/ask")
def ask(request: AskRequest):
    try:
        if request.video_id not in vectorstore_cache:
            transcript_obj = get_transcript(request.video_id)
            docs = transcript_to_docs(transcript_obj)
            vectorstore_cache[request.video_id] = build_vectorstore(docs)
        vectorstore = vectorstore_cache[request.video_id]
        result = ask_question(request.question, vectorstore)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing question: {str(e)}")

@app.get("/health")
def health_check():
    return {"status": "healthy"}
