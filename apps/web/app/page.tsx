"use client"

import { useRouter } from "next/navigation"


export default function Home(){
    const router = useRouter();

    return <div>
        <button onClick={() => {
            router.push("/signup");
        }}>go to signup page</button>
    </div>
}