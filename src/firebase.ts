/**
 * Firebase Client Initialization & Utilities
 */
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User
} from "firebase/auth";
import {
  getFirestore,
  doc,
  collection,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  deleteDoc
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const currentAuthUser = auth.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentAuthUser?.uid,
      email: currentAuthUser?.email,
      emailVerified: currentAuthUser?.emailVerified,
      isAnonymous: currentAuthUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error("Firestore Error:", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firestore with Database ID from config
export const db = getFirestore(app, (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId || "ai-studio-mepprojectmanage-00a43a1f-a078-48ae-aaab-9ae2bf8cb3c0");

// Initialize Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Helper to sign in with Google
export async function signInWithGoogle(): Promise<User> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    // Upsert User profile document in Firestore
    const userRef = doc(db, "users", user.uid);
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "MEP Specialist",
      role: "Engineer",
      photoURL: user.photoURL || "",
      updatedAt: new Date().toISOString()
    }, { merge: true });

    return user;
  } catch (err) {
    console.error("Firebase Google Sign-In failed:", err);
    throw err;
  }
}

// Helper to log out
export async function logoutFirebase(): Promise<void> {
  await signOut(auth);
}

// Sync user note to Firestore
export async function saveNoteToFirestore(userId: string, note: { id: string; title: string; content: string; trade?: string; projectId?: string }) {
  const path = `users/${userId}/notes/${note.id}`;
  try {
    const noteRef = doc(db, "users", userId, "notes", note.id);
    await setDoc(noteRef, {
      id: note.id,
      userId,
      title: note.title,
      content: note.content,
      trade: note.trade || "General",
      projectId: note.projectId || "ALL",
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, path);
  }
}

// Sync bookmarked supplier from Maps Grounding to Firestore
export async function saveBookmarkToFirestore(userId: string, bookmark: { id: string; name: string; category: string; address?: string; phone?: string; rating?: string; mapsUrl?: string; notes?: string }) {
  const path = `users/${userId}/bookmarks/${bookmark.id}`;
  try {
    const bmRef = doc(db, "users", userId, "bookmarks", bookmark.id);
    await setDoc(bmRef, {
      id: bookmark.id,
      userId,
      name: bookmark.name,
      category: bookmark.category,
      address: bookmark.address || "",
      phone: bookmark.phone || "",
      rating: bookmark.rating || "",
      mapsUrl: bookmark.mapsUrl || "",
      notes: bookmark.notes || "",
      createdAt: new Date().toISOString()
    }, { merge: true });
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, path);
  }
}

// Sync Chat conversation to Firestore
export async function saveChatSessionToFirestore(userId: string, conversation: { id: string; title: string; persona: string; modelTier: string; lastMessage: string; messages: any[] }) {
  const path = `users/${userId}/conversations/${conversation.id}`;
  try {
    const convRef = doc(db, "users", userId, "conversations", conversation.id);
    await setDoc(convRef, {
      id: conversation.id,
      userId,
      title: conversation.title,
      persona: conversation.persona,
      modelTier: conversation.modelTier,
      lastMessage: conversation.lastMessage.slice(0, 300),
      messageCount: conversation.messages.length,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    // Store messages in subcollection
    for (const msg of conversation.messages) {
      const msgId = msg.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const msgRef = doc(db, "users", userId, "conversations", conversation.id, "messages", msgId);
      await setDoc(msgRef, {
        id: msgId,
        conversationId: conversation.id,
        userId,
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : (msg.text || ""),
        groundingSources: msg.grounding_data ? JSON.stringify(msg.grounding_data) : "",
        timestamp: msg.timestamp || new Date().toISOString()
      }, { merge: true });
    }
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, path);
  }
}
