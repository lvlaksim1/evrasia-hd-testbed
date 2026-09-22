import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { SEED_RESTAURANTS, type Restaurant } from "@/data/evrasia-seed";
import type { AuthTokens } from "@/lib/evrasia-api";
export type Account = { phone: string; bonusPoints: number; bonusPercent: number; totalSpent: number; lastUpdated: string; lastCheckinAt?: number; lastCheckinCode?: string };
const ACCOUNTS_KEY = "evrasia_hd_accounts_v1"; const RESTAURANTS_KEY = "evrasia_hd_restaurants_v1";
const tokenKey=(p:string)=>`evrasia_hd_tokens_${p.replace(/\D/g,"")}`; const passwordKey=(p:string)=>`evrasia_hd_password_${p.replace(/\D/g,"")}`; const webKey=(p:string)=>`evrasia_hd_web_${p.replace(/\D/g,"")}`;
function classifyRestaurants(items: Restaurant[]): Restaurant[] { const seen=new Set<number>(); return items.map(item=>{ if(item.kind)return item; const kind:Restaurant["kind"]=seen.has(item.id)?"alias":"address"; seen.add(item.id); return {...item,kind}; }); }
export async function loadAccounts(){const raw=await AsyncStorage.getItem(ACCOUNTS_KEY);try{return raw?JSON.parse(raw):[]}catch{return[]}}
export async function saveAccounts(a:Account[]){await AsyncStorage.setItem(ACCOUNTS_KEY,JSON.stringify(a))}
export async function loadRestaurants(){const raw=await AsyncStorage.getItem(RESTAURANTS_KEY);let source:any=SEED_RESTAURANTS;try{if(raw)source=JSON.parse(raw)}catch{} const r=classifyRestaurants(source);await saveRestaurants(r);return r}
export async function saveRestaurants(r:Restaurant[]){await AsyncStorage.setItem(RESTAURANTS_KEY,JSON.stringify(r))}
export async function saveTokens(p:string,t:AuthTokens){await SecureStore.setItemAsync(tokenKey(p),JSON.stringify(t))}
export async function loadTokens(p:string):Promise<AuthTokens|null>{const r=await SecureStore.getItemAsync(tokenKey(p));try{return r?JSON.parse(r):null}catch{return null}}
export async function savePassword(p:string,v:string){await SecureStore.setItemAsync(passwordKey(p),v)}
export async function loadPassword(p:string){return SecureStore.getItemAsync(passwordKey(p))}
export async function saveWebSession(p:string,v:string){await SecureStore.setItemAsync(webKey(p),v)}
export async function loadWebSession(p:string){return SecureStore.getItemAsync(webKey(p))}
export async function deleteAccountSecrets(p:string){await Promise.all([SecureStore.deleteItemAsync(tokenKey(p)),SecureStore.deleteItemAsync(passwordKey(p)),SecureStore.deleteItemAsync(webKey(p))])}
