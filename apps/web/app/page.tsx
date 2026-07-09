"use client"

import axios from "axios";
import { useState } from "react";

const API_BASE = "http://localhost:3000/api/v1/upload";

export default function Home() {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState<string>("");
    const [documentId, setDocumentId] = useState<string | null>(null);

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);

        try {
            // 1. Ask backend for a presigned PUT url
            setStatus("Requesting upload URL...");
            const { data: { presignedUrl, key } } = await axios.post(
                `${API_BASE}/post-file-url`,
                { fileName: file.name, contentType: file.type }
            );

            // 2. Upload the raw file bytes directly to storage
            setStatus("Uploading file...");
            const res = await axios.put(presignedUrl, file, {
                headers: { "Content-Type": file.type },
            });
            console.log(res.data);

            if(res.status == 200){
                // 3. Tell backend the upload finished, so it can verify + queue processing
                setStatus("Confirming upload...");
                console.log(`file size: ${file.size}`)
                const { data } = await axios.post(`${API_BASE}/confirm`, {
                    fileName: file.name,
                    key,
                    size: file.size,
                });
                setDocumentId(data.documentId);
                setStatus("Upload complete.");
            }else{
                setStatus("Upload failed - unexpected response (not 200)");
            }
        } catch (e) {
            console.error(e);
            setStatus("Upload failed.");
        } finally {
            setUploading(false);
        }
    };

    const handleDownload = async () => {
        if (!documentId) return;
        const { data } = await axios.post(`${API_BASE}/get-file-url`, { documentId });
        window.open(data.presignedUrl, "_blank");
    };

    return (
        <div>
            <input type="file" onChange={(e) => {
                    const selected = e.target.files?.[0];
                    if (selected) setFile(selected);
                }}
            />
            {file && <p>{file.name}</p>}

            <button onClick={handleUpload} disabled={!file || uploading}>
                {uploading ? "Uploading..." : "Submit file"}
            </button>

            {status && <p>{status}</p>}

            {documentId && ( <button onClick={handleDownload}>Download file</button> )}
        </div>
    );
}