"use client"

import { useRef } from "react"
import axios from "axios"
import { useRouter } from "next/navigation"

export default function Signup(){
    const router = useRouter();
    const usernameRef = useRef<HTMLInputElement>(null)
    const passwordRef = useRef<HTMLInputElement>(null)

    async function handleAuth(){
        const username = usernameRef.current?.value;
        const password = passwordRef.current?.value;

        try{
            const res = await axios.post("http://localhost:3000/api/v1/auth/signup", {
                username, password    
            });
            console.log(res.data);
            router.push("/signin");
        }catch(e){
            alert("Error signing up: " + e);
        }
    }

    return <div>
        <input placeholder="Enter username..." ref={usernameRef} />
        <input placeholder="Enter password..." ref={passwordRef} />

        <button onClick={handleAuth}>Submit</button>
    </div>

}