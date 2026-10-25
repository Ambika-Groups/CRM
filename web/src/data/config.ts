/**
 * Data mode (decisions D-37). Firebase mode when the NEXT_PUBLIC_FIREBASE_* variables are set at build
 * time; demo mode only when none of them is. Each variable is referenced literally so Next.js inlines it
 * into the static export.
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

/** True if ANY Firebase variable is present. A partial config is an error in Firebase mode, never a fallback to demo. */
export const firebaseConfigPresent = Object.values(firebaseConfig).some((v) => v.trim() !== "");

export const firebaseConfigComplete = !!(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);

export type DataMode = "demo" | "firebase";

export const dataMode: DataMode = firebaseConfigPresent ? "firebase" : "demo";
