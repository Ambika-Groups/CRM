// Imported first by everything that uses the Admin SDK, so the app exists before any module-level getFirestore().
import { getApps, initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";

if (getApps().length === 0) initializeApp();
// Mumbai, next to the database (Firestore asia-south1). A small cap keeps a runaway client from running up the bill (₹0 plan).
setGlobalOptions({ region: "asia-south1", maxInstances: 5, memory: "512MiB" });
