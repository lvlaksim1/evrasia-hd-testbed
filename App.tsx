import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator, Animated, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal,
  PanResponder, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from "react-native";
import { NativeModules } from "react-native";
import * as Clipboard from "expo-clipboard";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  commonApiLogin, downloadRestaurants, friendlyApiError, getBonusCardTypes, getCheckin,
  getCommonCardCids, getCommonHistory, getProfile, getWriteOffCode, isAuthError, login,
  refreshTokens, refreshUser, updateProfile, type BonusCardType, type EditableProfile,
  type ProfileData, type UserCard,
} from "@/lib/evrasia-api";
import {
  deleteAccountSecrets, loadAccounts, loadPassword, loadRestaurants, loadTokens,
  loadWebSession, saveAccounts, savePassword, saveRestaurants, saveTokens, saveWebSession,
  type Account,
} from "@/lib/evrasia-storage";
import type { Restaurant } from "@/data/evrasia-seed";

const SmsCode = NativeModules.SmsCode as { ensurePermission: () => Promise<boolean>; startWaiting: (checkin: string) => Promise<boolean> };
const AppearanceMedia = NativeModules.AppearanceMedia as {
  appVersion?: string;
  getSettings: () => Promise<{ logoUri?: string; videoUri?: string; iconUri?: string }>;
  pickLogo: () => Promise<string | null>;
  pickVideo: () => Promise<string | null>;
  pickLauncherIcon: () => Promise<string | null>;
  reset: (kind: "logo" | "video" | "icon") => Promise<boolean>;
};
const APP_VERSION = AppearanceMedia?.appVersion || "v1";
const CHECKIN_WINDOW_MS = 3 * 60 * 60 * 1000;
type SettingsSection = "root" | "restaurants" | "cardTypes" | "appearance" | "log";
type DialogAction = { label: string; kind?: "primary" | "secondary" | "danger"; onPress?: () => void | Promise<void> };
type AppDialog = { title: string; message?: string; actions: DialogAction[] } | null;
type HistoryEntry = { title: string; lines: string[]; timestamp: number };
type ActionLogEntry = { id: string; timestamp: number; message: string };
const ACTION_LOG_KEY = "@evrasia/actionLog";
const ACTION_LOG_LIMIT = 500;

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8")) ? digits.slice(1) : digits;
}
function mobilePhone(value: string) { return `7${normalizePhone(value)}`; }
function commonApiPhone(value: string) {
  const d = normalizePhone(value);
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}
function normTitle(value: string) { return value.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " "); }
function sortRestaurants(items: Restaurant[]) {
  return [...items].sort((a, b) => normTitle(a.title).localeCompare(normTitle(b.title), "ru", { sensitivity: "base" }));
}
function cleanHtml(html: string) {
  return html
    .replace(/<i\b[^>]*class=["'][^"']*\brub\b[^"']*["'][^>]*>\s*c\s*<\/i>/gi, "₽")
    .replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/(div|p|li)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function parseHistory(text: string): HistoryEntry[] {
  const lines = text.split("\n").map(v => v.replace(/\u200B/g, "").trim()).filter(Boolean);
  let current: { title: string; lines: string[] } | null = null;
  const raw: Array<{ title: string; lines: string[] }> = [];
  for (const line of lines) {
    const start = /^Заказ\s*№/i.test(line) || /^Годовое обслуживание/i.test(line) || /^Обслуживание бонусного счета/i.test(line);
    if (start) {
      if (current) raw.push(current);
      current = { title: line, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) raw.push(current);
  return raw.map(entry => ({ ...entry, timestamp: 0 }));
}
function checkinCountdown(lastCheckinAt?: number, now = Date.now()) {
  if (!lastCheckinAt) return "";
  const left = lastCheckinAt + CHECKIN_WINDOW_MS - now;
  if (left <= 0) return "";
  const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000), s = Math.floor((left % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function displayRestaurantKind(kind?: Restaurant["kind"]) { return kind === "alias" ? "синоним" : "адрес"; }

type SortableControls = { onLongPress: () => void; onPressOut: () => void; isActive: boolean; blockPress: boolean };
type DragPreview = { from: number; to: number; height: number } | null;

function SortableAccountRow({ index, count, rowHeights, targetTop, onHeightChange, onDragPreview, onDragCancel, onReorder, onDragEnd, children }: {
  index: number;
  count: number;
  rowHeights: number[];
  targetTop: number;
  onHeightChange: (height: number) => void;
  onDragPreview: (from: number, to: number, height: number) => void;
  onDragCancel: () => void;
  onReorder: (from: number, to: number) => void;
  onDragEnd: () => void;
  children: (controls: SortableControls) => ReactNode;
}) {
  const positionY = useRef(new Animated.Value(targetTop)).current;
  const activeRef = useRef(false);
  const claimedRef = useRef(false);
  const originIndexRef = useRef(index);
  const hoverIndexRef = useRef(index);
  const countRef = useRef(count);
  const rowHeightRef = useRef(140);
  const rowHeightsRef = useRef(rowHeights);
  const dragHeightsRef = useRef(rowHeights);
  const targetTopRef = useRef(targetTop);
  const originTopRef = useRef(targetTop);
  const settlingTargetRef = useRef<number | null>(null);
  const heightChangeRef = useRef(onHeightChange);
  const previewRef = useRef(onDragPreview);
  const cancelRef = useRef(onDragCancel);
  const reorderRef = useRef(onReorder);
  const dragEndRef = useRef(onDragEnd);
  const [isActive, setIsActive] = useState(false);
  const [blockPress, setBlockPress] = useState(false);

  countRef.current = count;
  rowHeightsRef.current = rowHeights;
  targetTopRef.current = targetTop;
  heightChangeRef.current = onHeightChange;
  previewRef.current = onDragPreview;
  cancelRef.current = onDragCancel;
  reorderRef.current = onReorder;
  dragEndRef.current = onDragEnd;

  const measuredHeight = (heights: number[], itemIndex: number) => {
    const value = heights[itemIndex];
    return Number.isFinite(value) && value > 0 ? value : Math.max(rowHeightRef.current, 1);
  };

  const targetForTranslation = (from: number, translation: number) => {
    const heights = dragHeightsRef.current;
    let target = from;
    let distance = 0;

    if (translation > 0) {
      for (let candidate = from + 1; candidate < countRef.current; candidate += 1) {
        const candidateHeight = measuredHeight(heights, candidate);
        if (translation < distance + candidateHeight * 0.5) break;
        target = candidate;
        distance += candidateHeight;
      }
    } else if (translation < 0) {
      const upward = -translation;
      for (let candidate = from - 1; candidate >= 0; candidate -= 1) {
        const candidateHeight = measuredHeight(heights, candidate);
        if (upward < distance + candidateHeight * 0.5) break;
        target = candidate;
        distance += candidateHeight;
      }
    }

    return target;
  };

  const translationForTarget = (from: number, to: number) => {
    const heights = dragHeightsRef.current;
    let distance = 0;

    if (to > from) {
      for (let itemIndex = from + 1; itemIndex <= to; itemIndex += 1) {
        distance += measuredHeight(heights, itemIndex);
      }
      return distance;
    }

    if (to < from) {
      for (let itemIndex = to; itemIndex < from; itemIndex += 1) {
        distance += measuredHeight(heights, itemIndex);
      }
      return -distance;
    }

    return 0;
  };

  useEffect(() => {
    if (activeRef.current) return;
    Animated.spring(positionY, {
      toValue: targetTop,
      damping: 24,
      stiffness: 260,
      mass: 0.7,
      overshootClamping: true,
      useNativeDriver: true,
    }).start();
  }, [positionY, targetTop]);

  useLayoutEffect(() => {
    const settlingTarget = settlingTargetRef.current;
    if (settlingTarget !== null && index === settlingTarget) {
      settlingTargetRef.current = null;
      activeRef.current = false;
      setIsActive(false);
      dragEndRef.current();
      setTimeout(() => setBlockPress(false), 180);
    }
  }, [index]);

  const finishDrag = () => {
    if (!activeRef.current) return;
    claimedRef.current = false;

    const from = originIndexRef.current;
    const to = hoverIndexRef.current;
    const moved = from !== to;

    if (!moved) {
      Animated.spring(positionY, {
        toValue: targetTopRef.current,
        damping: 18,
        stiffness: 240,
        mass: 0.65,
        overshootClamping: true,
        useNativeDriver: true,
      }).start(() => {
        activeRef.current = false;
        setIsActive(false);
        cancelRef.current();
        setTimeout(() => setBlockPress(false), 80);
      });
      return;
    }

    const targetY = originTopRef.current + translationForTarget(from, to);
    Animated.spring(positionY, {
      toValue: targetY,
      damping: 22,
      stiffness: 280,
      mass: 0.7,
      overshootClamping: true,
      useNativeDriver: true,
    }).start(() => {
      settlingTargetRef.current = to;
      reorderRef.current(from, to);
    });
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => activeRef.current && Math.abs(gesture.dy) > 2,
    onMoveShouldSetPanResponderCapture: (_, gesture) => activeRef.current && Math.abs(gesture.dy) > 2,
    onPanResponderGrant: () => { claimedRef.current = true; },
    onPanResponderMove: (_, gesture) => {
      if (!activeRef.current) return;

      const from = originIndexRef.current;
      const target = targetForTranslation(from, gesture.dy);

      if (target !== hoverIndexRef.current) {
        hoverIndexRef.current = target;
        previewRef.current(from, target, Math.max(rowHeightRef.current, 1));
      }

      positionY.setValue(originTopRef.current + gesture.dy);
    },
    onPanResponderRelease: finishDrag,
    onPanResponderTerminate: finishDrag,
    onPanResponderTerminationRequest: () => false,
  }), [positionY]);

  const onLongPress = () => {
    activeRef.current = true;
    claimedRef.current = false;
    originIndexRef.current = index;
    hoverIndexRef.current = index;
    settlingTargetRef.current = null;
    dragHeightsRef.current = rowHeightsRef.current.slice();
    originTopRef.current = targetTopRef.current;
    positionY.stopAnimation();
    positionY.setValue(originTopRef.current);
    setBlockPress(true);
    setIsActive(true);
    previewRef.current(index, index, Math.max(rowHeightRef.current, 1));
  };

  const onPressOut = () => {
    setTimeout(() => {
      if (activeRef.current && !claimedRef.current) finishDrag();
    }, 0);
  };

  return <Animated.View
    {...responder.panHandlers}
    onLayout={event => {
      const height = event.nativeEvent.layout.height;
      rowHeightRef.current = height;
      heightChangeRef.current(height);
    }}
    style={[
      styles.accountItem,
      { position: "absolute", left: 0, right: 0, top: 0, transform: [{ translateY: positionY }] },
      isActive && styles.dragActive,
    ]}
  >
    {children({ onLongPress, onPressOut, isActive, blockPress })}
  </Animated.View>;
}

export default function HomeScreen() {
  const [accountListState, setAccountListState] = useState<{ accounts: Account[]; dragPreview: DragPreview }>({ accounts: [], dragPreview: null });
  const accounts = accountListState.accounts;
  const dragPreview = accountListState.dragPreview;
  const setAccounts = (nextAccounts: Account[] | ((current: Account[]) => Account[])) => {
    setAccountListState(current => ({
      ...current,
      accounts: typeof nextAccounts === "function" ? nextAccounts(current.accounts) : nextAccounts,
    }));
  };
  const setDragPreview = (nextPreview: DragPreview | ((current: DragPreview) => DragPreview)) => {
    setAccountListState(current => ({
      ...current,
      dragPreview: typeof nextPreview === "function" ? nextPreview(current.dragPreview) : nextPreview,
    }));
  };
  const [accountHeights, setAccountHeights] = useState<Record<string, number>>({});
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [busyPhone, setBusyPhone] = useState("");
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("root");
  const [loginVisible, setLoginVisible] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [addVisible, setAddVisible] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [addError, setAddError] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [restaurantVisible, setRestaurantVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [profileVisible, setProfileVisible] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileForm, setProfileForm] = useState<EditableProfile>({ name: "", lastname: "", email: "", birthday: "", gender: "" });
  const [cardDetail, setCardDetail] = useState<UserCard | null>(null);
  const [cardDetailLoading, setCardDetailLoading] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyText, setHistoryText] = useState("");
  const [cardTypes, setCardTypes] = useState<BonusCardType[]>([]);
  const [cardTypesBusy, setCardTypesBusy] = useState(false);
  const [aliasSource, setAliasSource] = useState<Restaurant | null>(null);
  const [aliasTitle, setAliasTitle] = useState("");
  const [dialog, setDialog] = useState<AppDialog>(null);
  const [clock, setClock] = useState(Date.now());
  const [bootReady, setBootReady] = useState(false);
  const [appearance, setAppearance] = useState({ logoUri: "", videoUri: "", iconUri: "" });
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
  const actionLogRef = useRef<ActionLogEntry[]>([]);
  const logWriteRef = useRef<Promise<void>>(Promise.resolve());
  const mainOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    Promise.all([loadAccounts(), loadRestaurants(), AppearanceMedia?.getSettings?.(), AsyncStorage.getItem("@evrasia/logoUri"), AsyncStorage.getItem(ACTION_LOG_KEY)]).then(([a, r, savedAppearance, savedLogoUri, savedLog]) => {
      if (!alive) return;
      setAccounts(a); setRestaurants(sortRestaurants(r));
      if (savedAppearance || savedLogoUri) setAppearance({ logoUri: savedLogoUri || savedAppearance?.logoUri || "", videoUri: savedAppearance?.videoUri || "", iconUri: savedAppearance?.iconUri || "" });
      let parsedLog: ActionLogEntry[] = [];
      try {
        const raw = savedLog ? JSON.parse(savedLog) : [];
        if (Array.isArray(raw)) parsedLog = raw.filter((item: any) => item && typeof item.id === "string" && typeof item.timestamp === "number" && typeof item.message === "string").slice(0, ACTION_LOG_LIMIT);
      } catch {}
      actionLogRef.current = parsedLog; setActionLog(parsedLog);
      appendLog(`Приложение запущено · версия ${APP_VERSION}`);
      setBootReady(true);
    });
    const clockTimer = setInterval(() => setClock(Date.now()), 1000);
    return () => { alive = false; clearInterval(clockTimer); };
  }, []);
  useEffect(() => {
    if (bootReady) Animated.timing(mainOpacity, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, [bootReady, mainOpacity]);

  const accountGeometry = useMemo(() => {
    let top = 0;
    const items = accounts.map(account => {
      const height = accountHeights[account.phone] || 140;
      const item = { top, height };
      top += height;
      return item;
    });
    return { items, totalHeight: top };
  }, [accounts, accountHeights]);
  const orderedAccountHeights = useMemo(() => accountGeometry.items.map(item => item.height), [accountGeometry]);
  const accountIndexByPhone = useMemo(() => new Map(accounts.map((account, index) => [account.phone, index])), [accounts]);
  const renderAccounts = useMemo(() => [...accounts].sort((left, right) => left.phone.localeCompare(right.phone)), [accounts]);

  const filteredRestaurants = useMemo(() => {
    const q = normTitle(query);
    return q ? restaurants.filter(r => normTitle(r.title).includes(q)) : restaurants;
  }, [query, restaurants]);
  const historyEntries = useMemo(() => parseHistory(historyText), [historyText]);

  function showMessage(title: string, message?: string) { appendLog(`Сообщение: ${title}${message ? ` · ${message.replace(/\s+/g, " ").slice(0, 240)}` : ""}`); setDialog({ title, message, actions: [{ label: "Понятно" }] }); }
  function confirmAction(title: string, message: string, onConfirm: () => void | Promise<void>) {
    setDialog({ title, message, actions: [{ label: "Отмена", kind: "secondary" }, { label: "Подтвердить", kind: "danger", onPress: onConfirm }] });
  }
  function requestPassword(account: Account) {
    appendLog(`Авторизация ${account.phone}: требуется ввод пароля`);
    setSelectedAccount(account); setPassword(""); setLoginError(""); setLoginVisible(true);
  }
  function appendLog(message: string) {
    const entry: ActionLogEntry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: Date.now(), message };
    const next = [entry, ...actionLogRef.current].slice(0, ACTION_LOG_LIMIT);
    actionLogRef.current = next; setActionLog(next);
    logWriteRef.current = logWriteRef.current.then(() => AsyncStorage.setItem(ACTION_LOG_KEY, JSON.stringify(next))).catch(() => {});
  }
  async function clearActionLog() {
    actionLogRef.current = []; setActionLog([]);
    logWriteRef.current = logWriteRef.current.then(() => AsyncStorage.removeItem(ACTION_LOG_KEY)).catch(() => {});
    await logWriteRef.current;
  }

  async function fullLogin(account: Account) {
    const savedPassword = await loadPassword(account.phone);
    if (!savedPassword) { appendLog(`Авторизация ${account.phone}: сохранённый пароль отсутствует`); requestPassword(account); throw new Error("AUTH_REQUIRED"); }
    appendLog(`Авторизация ${account.phone}: полный вход по сохранённому паролю`);
    try {
      const fresh = await login(mobilePhone(account.phone), savedPassword);
      await saveTokens(account.phone, fresh);
      appendLog(`Авторизация ${account.phone}: полный вход выполнен, получена новая пара токенов`);
      return fresh.access_token;
    } catch (error) {
      appendLog(`Авторизация ${account.phone}: полный вход не выполнен · ${friendlyApiError(error)}`);
      throw error;
    }
  }
  async function authenticate(account: Account) {
    const stored = await loadTokens(account.phone);
    if (stored?.access_token) {
      appendLog(`Авторизация ${account.phone}: используется сохранённый access token — вход по логину и refresh token не выполнялись`);
      return stored.access_token;
    }
    appendLog(`Авторизация ${account.phone}: access token отсутствует`);
    return fullLogin(account);
  }
  async function withAuth<T>(account: Account, action: (token: string) => Promise<T>) {
    let token = await authenticate(account);
    try {
      return await action(token);
    } catch (error) {
      if (!isAuthError(error)) throw error;
      appendLog(`Авторизация ${account.phone}: access token отклонён сервером (401/403)`);
    }

    const stored = await loadTokens(account.phone);
    let refreshed = false;
    if (stored?.refresh_token) {
      appendLog(`Авторизация ${account.phone}: попытка обновления через refresh token`);
      try {
        const fresh = await refreshTokens(token, stored.refresh_token);
        await saveTokens(account.phone, fresh);
        token = fresh.access_token;
        refreshed = true;
        appendLog(`Авторизация ${account.phone}: refresh token успешно обновил access и refresh token`);
      } catch (error) {
        appendLog(`Авторизация ${account.phone}: refresh token не сработал · ${friendlyApiError(error)}`);
      }
    } else {
      appendLog(`Авторизация ${account.phone}: refresh token отсутствует`);
    }

    if (refreshed) {
      try {
        const result = await action(token);
        appendLog(`Авторизация ${account.phone}: исходный запрос успешно повторён с новым access token`);
        return result;
      } catch (error) {
        if (!isAuthError(error)) throw error;
        appendLog(`Авторизация ${account.phone}: новый access token также отклонён, выполняется полный вход`);
      }
    }

    appendLog(`Авторизация ${account.phone}: fallback — повторный вход по сохранённому паролю`);
    token = await fullLogin(account);
    const result = await action(token);
    appendLog(`Авторизация ${account.phone}: исходный запрос успешно повторён после полного входа`);
    return result;
  }
  async function getFreshCommonSession(account: Account) {
    const savedPassword = await loadPassword(account.phone);
    if (!savedPassword) throw new Error("Для общего API нужен сохранённый пароль. Выполните вход в аккаунт ещё раз.");
    appendLog(`Общий API ${account.phone}: выполняется вход по сохранённому паролю`);
    try {
      const session = await commonApiLogin(commonApiPhone(account.phone), savedPassword);
      await saveWebSession(account.phone, session);
      appendLog(`Общий API ${account.phone}: новая web-сессия получена`);
      return session;
    } catch (error) {
      appendLog(`Общий API ${account.phone}: вход не выполнен · ${friendlyApiError(error)}`);
      throw error;
    }
  }
  async function commonCids(account: Account) {
    const saved = await loadWebSession(account.phone);
    if (saved) { try { return await getCommonCardCids(saved); } catch (e) { if (!isAuthError(e)) throw e; } }
    return getCommonCardCids(await getFreshCommonSession(account));
  }
  async function commonHistory(account: Account) {
    const saved = await loadWebSession(account.phone);
    if (saved) { try { return await getCommonHistory(saved); } catch (e) { if (!isAuthError(e)) throw e; } }
    return getCommonHistory(await getFreshCommonSession(account));
  }

  async function doLogin() {
    if (!selectedAccount || !password) return;
    setLoginError(""); appendLog(`Авторизация ${selectedAccount.phone}: ручной вход`);
    try {
      setBusyPhone(selectedAccount.phone);
      const tokens = await login(mobilePhone(selectedAccount.phone), password);
      await Promise.all([saveTokens(selectedAccount.phone, tokens), savePassword(selectedAccount.phone, password)]);
      appendLog(`Авторизация ${selectedAccount.phone}: ручной вход выполнен`);
      setLoginVisible(false); setPassword(""); await refreshAccount(selectedAccount);
    } catch (e) { appendLog(`Авторизация ${selectedAccount.phone}: ручной вход не выполнен · ${friendlyApiError(e)}`); setLoginError(friendlyApiError(e)); } finally { setBusyPhone(""); }
  }
  async function addAccount() {
    const phone = normalizePhone(newPhone);
    setAddError("");
    if (phone.length !== 10) return setAddError("Введите 10 цифр номера или полный российский номер.");
    if (!newPassword) return setAddError("Введите пароль.");
    if (accounts.some(a => a.phone === phone)) return setAddError("Этот аккаунт уже добавлен.");
    setAddingAccount(true); appendLog(`Аккаунт ${phone}: добавление начато`);
    try {
      const tokens = await login(mobilePhone(phone), newPassword);
      const data = await refreshUser(tokens.access_token);
      const account: Account = { phone, bonusPoints: data.bonusPoints, bonusPercent: data.bonusAccrualPercentage, totalSpent: data.overallPayedOrderSum, lastUpdated: new Date().toLocaleString("ru-RU") };
      const next = [...accounts, account];
      await Promise.all([saveTokens(phone, tokens), savePassword(phone, newPassword), saveAccounts(next)]);
      setAccounts(next); setAddVisible(false); setNewPhone(""); setNewPassword("");
      appendLog(`Аккаунт ${phone}: успешно добавлен`);
    } catch (e) { appendLog(`Аккаунт ${phone}: не удалось добавить · ${friendlyApiError(e)}`); setAddError(friendlyApiError(e)); } finally { setAddingAccount(false); }
  }
  async function refreshAccount(account: Account) {
    appendLog(`Аккаунт ${account.phone}: обновление данных`);
    try {
      setBusyPhone(account.phone);
      const data = await withAuth(account, token => refreshUser(token));
      const next = accounts.map(a => a.phone === account.phone ? { ...a, bonusPoints: data.bonusPoints, bonusPercent: data.bonusAccrualPercentage, totalSpent: data.overallPayedOrderSum, lastUpdated: new Date().toLocaleString("ru-RU") } : a);
      setAccounts(next); await saveAccounts(next);
      appendLog(`Аккаунт ${account.phone}: данные обновлены`);
    } catch (e: any) { if (e?.message !== "AUTH_REQUIRED") { appendLog(`Аккаунт ${account.phone}: ошибка обновления · ${friendlyApiError(e)}`); showMessage("Не удалось обновить аккаунт", friendlyApiError(e)); } } finally { setBusyPhone(""); }
  }
  async function refreshAll() {
    if (refreshingAll) return;
    setRefreshingAll(true); appendLog(`Обновление всех аккаунтов: запущено (${accounts.length})`);
    let next = [...accounts];
    try {
      for (const account of accounts) {
        try {
          setBusyPhone(account.phone);
          const data = await withAuth(account, token => refreshUser(token));
          const updated: Account = { ...account, bonusPoints: data.bonusPoints, bonusPercent: data.bonusAccrualPercentage, totalSpent: data.overallPayedOrderSum, lastUpdated: new Date().toLocaleString("ru-RU") };
          next = next.map(a => a.phone === account.phone ? updated : a);
          setAccounts(next); await saveAccounts(next);
          appendLog(`Аккаунт ${account.phone}: обновлён в общем цикле`);
        } catch (e: any) {
          if (e?.message !== "AUTH_REQUIRED") { appendLog(`Аккаунт ${account.phone}: ошибка общего обновления · ${friendlyApiError(e)}`); showMessage("Не удалось обновить аккаунт", friendlyApiError(e)); }
        }
      }
    } finally {
      setBusyPhone(""); setRefreshingAll(false); appendLog("Обновление всех аккаунтов: завершено");
    }
  }
  async function checkin(restaurant: Restaurant) {
    if (!selectedAccount) return;
    const account = selectedAccount; setRestaurantVisible(false); appendLog(`Чекин ${account.phone}: ${restaurant.title}`);
    try {
      setBusyPhone(account.phone);
      const code = await withAuth(account, token => getCheckin(token, restaurant.id));
      await Clipboard.setStringAsync(code);
      const next = accounts.map(a => a.phone === account.phone ? { ...a, lastCheckinCode: code, lastCheckinAt: Date.now() } : a);
      setAccounts(next); await saveAccounts(next);
      appendLog(`Чекин ${account.phone}: получен и скопирован в буфер обмена`);
    } catch (e: any) { if (e?.message !== "AUTH_REQUIRED") { appendLog(`Чекин ${account.phone}: ошибка · ${friendlyApiError(e)}`); showMessage("Ошибка чекина", friendlyApiError(e)); } } finally { setBusyPhone(""); }
  }
  async function requestWriteOff(account: Account) {
    appendLog(`Код списания ${account.phone}: запрос начат`);
    try {
      setBusyPhone(account.phone);
      const allowed = await SmsCode?.ensurePermission?.();
      if (!allowed) { appendLog(`Код списания ${account.phone}: нет разрешения на SMS`); showMessage("Доступ к SMS", "Разрешите приложению получать SMS для автоматического перехвата 4-значного кода."); return; }
      await SmsCode.startWaiting(account.lastCheckinCode || "");
      await withAuth(account, token => getWriteOffCode(token));
      appendLog(`Код списания ${account.phone}: запрос отправлен, ожидается SMS`);
      showMessage("Ожидаем SMS", "После получения кода в буфер обмена автоматически попадёт строка с чекином и кодом списания.");
    } catch (e: any) {
      if (e?.message !== "AUTH_REQUIRED") { appendLog(`Код списания ${account.phone}: ошибка · ${friendlyApiError(e)}`); showMessage("Не удалось запросить код списания", friendlyApiError(e)); }
    } finally { setBusyPhone(""); }
  }
  async function openHistory(account: Account) {
    setSelectedAccount(account); setHistoryVisible(true); setHistoryBusy(true); setHistoryText(""); appendLog(`История ${account.phone}: запрос`);
    try { const r = await commonHistory(account); setHistoryText(cleanHtml(r.historyHtml) || ""); appendLog(`История ${account.phone}: получена`); }
    catch (e) { appendLog(`История ${account.phone}: ошибка · ${friendlyApiError(e)}`); setHistoryText(`Ошибка получения истории\n\n${friendlyApiError(e)}`); }
    finally { setHistoryBusy(false); }
  }
  async function openProfile(account: Account) {
    setSelectedAccount(account); setProfileVisible(true); setProfileBusy(true); setProfile(null); appendLog(`Профиль ${account.phone}: открытие`);
    try {
      const data = await withAuth(account, token => getProfile(token));
      setProfile(data); setProfileForm({ name: data.name, lastname: data.lastname, email: data.email, birthday: data.birthday, gender: data.gender });
      appendLog(`Профиль ${account.phone}: данные получены`);
    } catch (e: any) { if (e?.message !== "AUTH_REQUIRED") { appendLog(`Профиль ${account.phone}: ошибка · ${friendlyApiError(e)}`); showMessage("Ошибка профиля", friendlyApiError(e)); } } finally { setProfileBusy(false); }
  }
  async function saveProfile() {
    if (!selectedAccount || profileSaving) return;
    Keyboard.dismiss(); setProfileSaving(true); appendLog(`Профиль ${selectedAccount.phone}: сохранение изменений`);
    try {
      await withAuth(selectedAccount, token => updateProfile(token, profileForm));
      const data = await withAuth(selectedAccount, token => getProfile(token));
      setProfile(data); setProfileForm({ name: data.name, lastname: data.lastname, email: data.email, birthday: data.birthday, gender: data.gender });
      appendLog(`Профиль ${selectedAccount.phone}: изменения сохранены`);
      showMessage("Профиль сохранён", "Изменения успешно отправлены на сервер.");
    } catch (e: any) { if (e?.message !== "AUTH_REQUIRED") { appendLog(`Профиль ${selectedAccount.phone}: ошибка сохранения · ${friendlyApiError(e)}`); showMessage("Не удалось сохранить профиль", friendlyApiError(e)); } }
    finally { setProfileSaving(false); }
  }
  async function openCardDetails(account: Account, card: UserCard, index: number) {
    setCardDetail({ ...card, cid: undefined }); setCardDetailLoading(true); appendLog(`Карта ${account.phone}: запрос cid`);
    try {
      const cids = await commonCids(account);
      const direct = Number(card.cardIdInBX);
      setCardDetail({ ...card, cid: cids.includes(direct) ? direct : cids[index] });
      appendLog(`Карта ${account.phone}: cid получен`);
    } catch (e) { appendLog(`Карта ${account.phone}: ошибка получения cid · ${friendlyApiError(e)}`); showMessage("Не удалось получить cid карты", friendlyApiError(e)); } finally { setCardDetailLoading(false); }
  }
  async function openCardTypes() {
    setSettingsSection("cardTypes"); setCardTypesBusy(true); setCardTypes([]); appendLog("Типы карт: запрос справочника");
    if (!accounts[0]) { setCardTypesBusy(false); appendLog("Типы карт: нет аккаунта для авторизации"); return; }
    try { setCardTypes(await withAuth(accounts[0], token => getBonusCardTypes(token))); appendLog("Типы карт: справочник получен"); }
    catch (e) { appendLog(`Типы карт: ошибка · ${friendlyApiError(e)}`); showMessage("Типы карт", friendlyApiError(e)); } finally { setCardTypesBusy(false); }
  }
  async function deleteAccount(account: Account) {
    const next = accounts.filter(a => a.phone !== account.phone);
    await deleteAccountSecrets(account.phone); await saveAccounts(next); setAccounts(next); appendLog(`Аккаунт ${account.phone}: удалён`);
  }
  async function updateRestaurants() {
    appendLog("Рестораны: актуализация списка начата");
    try {
      setBusyPhone("restaurants");
      const fresh = await downloadRestaurants();
      const canonical = new globalThis.Set(fresh.map(r => `${r.id}|${normTitle(r.title)}`));
      const repaired = restaurants.map(r => ({ ...r, kind: canonical.has(`${r.id}|${normTitle(r.title)}`) ? "address" as const : "alias" as const }));
      const existing = new globalThis.Set(repaired.map(r => `${r.id}|${normTitle(r.title)}`));
      const added = fresh.filter(r => !existing.has(`${r.id}|${normTitle(r.title)}`)).map(r => ({ ...r, kind: "address" as const }));
      const next = sortRestaurants([...repaired, ...added]);
      await saveRestaurants(next); setRestaurants(next);
      const addressCount = next.filter(r => r.kind === "address").length, aliasCount = next.filter(r => r.kind === "alias").length;
      const addedText = added.length ? `\n\nДобавлены:\n${added.map(r => `• ${r.title}`).join("\n")}` : "\n\nНовых ресторанов нет.";
      appendLog(`Рестораны: список актуализирован · адресов ${addressCount}, синонимов ${aliasCount}, добавлено ${added.length}`);
      showMessage("Список ресторанов обновлён", `Ресторанов: ${addressCount}\nСинонимов: ${aliasCount}\nДобавлено: ${added.length}${addedText}`);
    } catch (e) { appendLog(`Рестораны: ошибка актуализации · ${friendlyApiError(e)}`); showMessage("Не удалось обновить рестораны", friendlyApiError(e)); } finally { setBusyPhone(""); }
  }
  async function addAlias() {
    if (!aliasSource || !aliasTitle.trim()) return;
    const title = aliasTitle.trim();
    const next = sortRestaurants([...restaurants, { id: aliasSource.id, title, kind: "alias" as const }]);
    setRestaurants(next); await saveRestaurants(next); appendLog(`Рестораны: добавлен синоним «${title}» для «${aliasSource.title}»`); setAliasSource(null); setAliasTitle("");
  }
  async function deleteRestaurant(item: Restaurant) {
    const index = restaurants.findIndex(r => r.id === item.id && r.title === item.title && r.kind === item.kind);
    if (index < 0) return;
    const next = sortRestaurants(restaurants.filter((_, i) => i !== index));
    setRestaurants(next); await saveRestaurants(next); appendLog(`Рестораны: удалена запись «${item.title}»`); setAliasSource(null); setAliasTitle("");
  }
  async function chooseAppearance(kind: "logo" | "video" | "icon") {
  try {
    if (kind === "logo") {
      const uri = await AppearanceMedia.pickLogo();
      if (!uri) return;
      await AsyncStorage.removeItem("@evrasia/logoUri");
      setAppearance(prev => ({ ...prev, logoUri: uri }));
      appendLog("Оформление: выбран пользовательский логотип");
      return;
    }
    const uri = kind === "video" ? await AppearanceMedia.pickVideo() : await AppearanceMedia.pickLauncherIcon();
    if (!uri) return;
    setAppearance(prev => ({ ...prev, [kind === "video" ? "videoUri" : "iconUri"]: uri }));
    appendLog(kind === "video" ? "Оформление: выбрано пользовательское стартовое видео" : "Оформление: выбрана пользовательская иконка и создан ярлык");
    if (kind === "icon") showMessage("Иконка выбрана", "Android не разрешает произвольно заменить системную иконку установленного приложения. Поэтому создан новый ярлык Евразия hd с выбранной картинкой. Старый ярлык можно удалить с рабочего стола.");
  } catch (e) { appendLog(`Оформление: ошибка · ${friendlyApiError(e)}`); showMessage("Оформление", friendlyApiError(e)); }
}
  async function resetAppearance(kind: "logo" | "video") {
  if (kind === "logo") {
    await AsyncStorage.removeItem("@evrasia/logoUri");
    await AppearanceMedia.reset("logo");
  } else {
    await AppearanceMedia.reset(kind);
  }
  setAppearance(prev => ({ ...prev, [kind === "logo" ? "logoUri" : "videoUri"]: "" }));
  appendLog(kind === "logo" ? "Оформление: возвращён стандартный логотип" : "Оформление: возвращено стандартное стартовое видео");
}

  function closeSettings() {
    if (aliasSource) { setAliasSource(null); setAliasTitle(""); return; }
    if (settingsSection !== "root") { setSettingsSection("root"); setQuery(""); return; }
    setSettingsVisible(false);
  }

  if (!bootReady) return <View style={styles.startup}><StatusBar barStyle="light-content" /></View>;

  return <View style={styles.safe}>
    <StatusBar barStyle="light-content" />
    <Animated.View style={[styles.flex, { opacity: mainOpacity }] }>
      <SafeAreaView style={styles.safe}>
      <View style={styles.mainHeader}>
        <Pressable style={styles.squareHeaderButton} onPress={() => { setSettingsSection("root"); setSettingsVisible(true); }}>
          <View style={styles.menuLine} /><View style={styles.menuLine} /><View style={styles.menuLine} />
        </Pressable>
        {appearance.logoUri ? <Image source={{ uri: appearance.logoUri }} style={styles.customBrandLogo} resizeMode="contain" /> : <Image source={require("./assets/evrasia_hd_logo.png")} style={styles.customBrandLogo} resizeMode="contain" />}
        <Pressable style={styles.squareHeaderButton} onPress={() => void refreshAll()} disabled={refreshingAll || !accounts.length}>
          {refreshingAll ? <ActivityIndicator color="#F4C35A" /> : <Text style={[styles.headerRefresh, !accounts.length && styles.disabledText]}>↻</Text>}
        </Pressable>
      </View>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        scrollEnabled={!dragPreview}
      >
        {!accounts.length ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Аккаунтов пока нет</Text><Text style={styles.muted}>Добавьте аккаунт в настройках.</Text></View> : <View style={{ height: accountGeometry.totalHeight }}>
          {renderAccounts.map(account => {
            const itemIndex = accountIndexByPhone.get(account.phone) ?? 0;
            const timer = checkinCountdown(account.lastCheckinAt, clock);
            const shiftOffset = !dragPreview ? 0
              : itemIndex > dragPreview.from && itemIndex <= dragPreview.to ? -dragPreview.height
              : itemIndex < dragPreview.from && itemIndex >= dragPreview.to ? dragPreview.height
              : 0;
            const targetTop = (accountGeometry.items[itemIndex]?.top || 0) + shiftOffset;
            return <SortableAccountRow
              key={account.phone}
              index={itemIndex}
              count={accounts.length}
              rowHeights={orderedAccountHeights}
              targetTop={targetTop}
              onHeightChange={height => setAccountHeights(current => Math.abs((current[account.phone] || 0) - height) < 0.5 ? current : { ...current, [account.phone]: height })}
              onDragPreview={(from, to, height) => setDragPreview(current => current?.from === from && current.to === to && current.height === height ? current : { from, to, height })}
              onDragCancel={() => setDragPreview(null)}
              onReorder={(from, to) => {
                setAccountListState(current => {
                  const next = [...current.accounts];
                  const [moved] = next.splice(from, 1);
                  next.splice(to, 0, moved);
                  void saveAccounts(next);
                  return { accounts: next, dragPreview: null };
                });
              }}
              onDragEnd={() => appendLog("Аккаунты: изменён порядок карточек")}
            >
              {({ onLongPress, onPressOut, isActive, blockPress }) => <View style={styles.accountCard}>
                <Pressable
                  style={styles.accountMain}
                  onPress={() => { if (!blockPress) openProfile(account); }}
                  onLongPress={onLongPress}
                  onPressOut={onPressOut}
                  delayLongPress={360}
                >
                  <View style={styles.rowBetween}><Text style={styles.phone}>{account.phone}</Text><View style={styles.refreshSlot} /></View>
                  <View style={styles.compactStats}>
                    <View><Text style={styles.statLabel}>Бонусы</Text><Text style={styles.bonus}>{account.bonusPoints.toLocaleString("ru-RU")}</Text></View>
                    <View style={styles.compactMetric}><Text style={styles.statLabel}>Начисление</Text><Text style={styles.metricValue}>{account.bonusPercent}%</Text></View>
                    <View style={styles.compactMetric}><Text style={styles.statLabel}>Покупки</Text><Text style={styles.metricValue}>{account.totalSpent.toLocaleString("ru-RU")} ₽</Text></View>
                  </View>
                  {account.lastCheckinCode ? <Text style={styles.checkinCode}>Последний чекин: {account.lastCheckinCode}</Text> : null}
                  {timer ? <Text style={styles.checkinTimer}>Следующий чекин через {timer}</Text> : null}
                  <Text style={styles.updated}>Обновлено: {account.lastUpdated || "—"}</Text>
                </Pressable>
                <Pressable style={[styles.refreshSlot, { position: "absolute", top: 18, right: 18, zIndex: 2 }]} onPress={() => refreshAccount(account)} disabled={busyPhone === account.phone || isActive}>
                  {busyPhone === account.phone ? <ActivityIndicator color="#F4C35A" /> : <Text style={styles.reload}>↻</Text>}
                </Pressable>
                <View style={styles.cardActions}>
                  <CardButton title="Чекин" onPress={() => { setSelectedAccount(account); setQuery(""); setRestaurantVisible(true); }} />
                  <CardButton title="Код" onPress={() => requestWriteOff(account)} />
                  <CardButton title="История" onPress={() => openHistory(account)} />
                </View>
              </View>}
            </SortableAccountRow>;
          })}
        </View>}
      </ScrollView>

      <Modal visible={settingsVisible} animationType="slide" onRequestClose={closeSettings}><SafeAreaView style={styles.safe}>
        <ScreenHeader title={settingsSection === "root" ? "Настройки" : settingsSection === "restaurants" ? "Рестораны" : settingsSection === "appearance" ? "Оформление" : settingsSection === "log" ? "Журнал действий" : "Типы карт"} onClose={closeSettings} back={settingsSection !== "root"} />
        {settingsSection === "root" && <View style={styles.settingsContent}>
          <PrimaryButton title="+ Добавить аккаунт" onPress={() => { setNewPhone(""); setNewPassword(""); setAddError(""); setAddVisible(true); }} />
          <SettingsRow title="Рестораны" onPress={() => { setQuery(""); setSettingsSection("restaurants"); }} />
          <SettingsRow title="Типы карт" onPress={openCardTypes} />
          <SettingsRow title="Оформление" onPress={() => setSettingsSection("appearance")} />
          <SettingsRow title="Журнал действий" onPress={() => setSettingsSection("log")} />
          <Text style={styles.settingsVersion}>версия {APP_VERSION}</Text>
        </View>}
        {settingsSection === "restaurants" && <View style={styles.flex}>
          <View style={styles.toolbar}><PrimaryButton title={busyPhone === "restaurants" ? "Обновление…" : "Актуализировать список"} onPress={updateRestaurants} loading={busyPhone === "restaurants"} /></View>
          <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Поиск ресторана" placeholderTextColor="#71857A" />
          {aliasSource && <View style={styles.aliasCard}>
            <View style={styles.aliasHeader}><Pressable style={styles.aliasClose} onPress={() => { setAliasSource(null); setAliasTitle(""); }}><Text style={styles.aliasCloseText}>×</Text></Pressable><View style={styles.flex}><Text style={styles.aliasTitle}>Синоним</Text><Text style={styles.aliasCaption}>{aliasSource.title}</Text></View></View>
            <TextInput style={styles.input} value={aliasTitle} onChangeText={setAliasTitle} placeholder="Новое название" placeholderTextColor="#71857A" />
            <PrimaryButton title="Добавить синоним" onPress={addAlias} />
            <SecondaryButton title="Удалить запись" danger onPress={() => confirmAction("Удалить запись?", aliasSource.title, () => deleteRestaurant(aliasSource))} />
          </View>}
          <FlatList data={filteredRestaurants} keyExtractor={(i, n) => `${i.id}-${i.title}-${n}`} renderItem={({ item }) =>
            <Pressable style={styles.restaurantRow} onPress={() => { setAliasSource(item); setAliasTitle(""); }}><View style={styles.restaurantDot} /><View style={styles.flex}><Text style={styles.restaurantTitle}>{item.title}</Text><Text style={styles.restaurantMeta}>ID {item.id} · {displayRestaurantKind(item.kind)}</Text></View></Pressable>} />
        </View>}
        {settingsSection === "appearance" && <ScrollView contentContainerStyle={styles.appearanceContent}>
          <View style={styles.appearanceCard}>
            <Text style={styles.appearanceTitle}>Логотип на главном экране</Text>
            <Text style={styles.appearanceNote}>Выберите изображение из файлов устройства.</Text>
            <Image source={appearance.logoUri ? { uri: appearance.logoUri } : require("./assets/evrasia_hd_logo.png")} style={styles.appearancePreview} resizeMode="contain" />
            <PrimaryButton title="Выбрать логотип" onPress={() => chooseAppearance("logo")} />
            {appearance.logoUri ? <SecondaryButton title="Вернуть стандартный" onPress={() => resetAppearance("logo")} /> : null}
          </View>
          <View style={styles.appearanceCard}>
            <Text style={styles.appearanceTitle}>Стартовое видео</Text>
            <Text style={styles.appearanceNote}>Выбранный ролик будет использоваться при следующем запуске приложения.</Text>
            <PrimaryButton title="Выбрать видео" onPress={() => chooseAppearance("video")} />
            {appearance.videoUri ? <SecondaryButton title="Вернуть стандартное" onPress={() => resetAppearance("video")} /> : null}
          </View>
          <View style={styles.appearanceCard}>
            <Text style={styles.appearanceTitle}>Иконка приложения</Text>
            <Text style={styles.appearanceNote}>Android не позволяет приложению заменить иконку в меню приложений произвольной картинкой. Будет создан ярлык на рабочем столе с выбранной иконкой.</Text>
            {appearance.iconUri ? <Image source={{ uri: appearance.iconUri }} style={styles.iconPreview} resizeMode="cover" /> : null}
            <PrimaryButton title="Выбрать иконку и создать ярлык" onPress={() => chooseAppearance("icon")} />
          </View>
        </ScrollView>}
        {settingsSection === "log" && <View style={styles.flex}>
          <View style={styles.toolbar}><SecondaryButton title="Очистить журнал" danger onPress={() => confirmAction("Очистить журнал?", "Будут удалены все записи журнала действий.", clearActionLog)} /></View>
          <FlatList data={actionLog} keyExtractor={item => item.id} contentContainerStyle={styles.logList} ListEmptyComponent={<Text style={styles.emptyListText}>Журнал пуст.</Text>} renderItem={({ item }) =>
            <View style={styles.logRow}><Text style={styles.logTime}>{new Date(item.timestamp).toLocaleString("ru-RU")}</Text><Text style={styles.logMessage}>{item.message}</Text></View>} />
        </View>}
        {settingsSection === "cardTypes" && <View style={styles.flex}>{cardTypesBusy ? <ActivityIndicator style={styles.loader} color="#F4C35A" size="large" /> :
          <FlatList data={cardTypes} keyExtractor={(i, n) => `${i.id}-${n}`} contentContainerStyle={styles.listContent} ListEmptyComponent={<Text style={styles.emptyListText}>Справочник пуст.</Text>} renderItem={({ item }) =>
            <View style={styles.typeCard}>{item.picture ? <Image source={{ uri: item.picture }} style={styles.typeImage} resizeMode="contain" /> : null}<View style={styles.flex}><Text style={styles.typeTitle}>{item.title}</Text><Text style={styles.restaurantMeta}>ID {item.id}</Text></View></View>} />}</View>}
      </SafeAreaView></Modal>

      <Modal visible={profileVisible} animationType="slide" onRequestClose={() => setProfileVisible(false)}><SafeAreaView style={styles.safe}>
        <ScreenHeader title={`Профиль${selectedAccount ? ` · ${selectedAccount.phone}` : ""}`} onClose={() => setProfileVisible(false)} />
        {profileBusy && !profile ? <ActivityIndicator style={styles.loader} color="#F4C35A" size="large" /> :
          <ScrollView contentContainerStyle={styles.profileContent} keyboardShouldPersistTaps="always">
            <ProfileField label="Имя" value={profileForm.name} onChange={v => setProfileForm({ ...profileForm, name: v })} />
            <ProfileField label="Фамилия" value={profileForm.lastname} onChange={v => setProfileForm({ ...profileForm, lastname: v })} />
            <ProfileField label="Email" value={profileForm.email} onChange={v => setProfileForm({ ...profileForm, email: v })} />
            <ProfileField label="Дата рождения" value={profileForm.birthday} onChange={v => setProfileForm({ ...profileForm, birthday: v })} />
            <Text style={styles.fieldLabel}>Пол</Text><View style={styles.genderRow}>
              <ChoiceButton title="М" active={profileForm.gender === "M"} onPress={() => setProfileForm({ ...profileForm, gender: "M" })} />
              <ChoiceButton title="Ж" active={profileForm.gender === "F"} onPress={() => setProfileForm({ ...profileForm, gender: "F" })} />
              <ChoiceButton title="—" active={!profileForm.gender} onPress={() => setProfileForm({ ...profileForm, gender: "" })} />
            </View>
            <PrimaryButton title={profileSaving ? "Сохранение…" : "Сохранить профиль"} onPress={saveProfile} loading={profileSaving} />
            {profile ? <View style={styles.profileMeta}><Text style={styles.muted}>Телефон: {profile.phone || "—"}</Text><Text style={styles.muted}>Регистрация: {profile.registerDate || "—"}</Text></View> : null}
            <Text style={styles.sectionTitle}>Карты пользователя</Text>
            {profile?.cards.map((card, index) => <Pressable key={`${card.cardIdInBX}-${index}`} style={styles.userCardCompact} onPress={() => selectedAccount && openCardDetails(selectedAccount, card, index)}>
              {card.picture ? <Image source={{ uri: card.picture }} style={styles.cardThumb} resizeMode="contain" /> : <View style={styles.cardThumbPlaceholder} />}
              <Text style={styles.cardTitle} numberOfLines={1}>{card.title || "Карта"}</Text>
            </Pressable>)}
            {selectedAccount ? <SecondaryButton title="Удалить аккаунт" danger onPress={() => confirmAction("Удалить аккаунт?", selectedAccount.phone, async () => { const accountToDelete = selectedAccount; await deleteAccount(accountToDelete); setProfileVisible(false); setSelectedAccount(null); })} /> : null}
          </ScrollView>}
      </SafeAreaView></Modal>

      <Modal visible={cardDetail !== null} animationType="slide" onRequestClose={() => setCardDetail(null)}><SafeAreaView style={styles.safe}>
        <ScreenHeader title="Подробности карты" onClose={() => setCardDetail(null)} />
        <ScrollView contentContainerStyle={styles.detailContent}>
          {cardDetail?.picture ? <Image source={{ uri: cardDetail.picture }} style={styles.detailImage} resizeMode="contain" /> : null}
          <Text style={styles.detailTitle}>{cardDetail?.title}</Text>
          {cardDetailLoading ? <View style={styles.cidLoading}><ActivityIndicator color="#F4C35A" /><Text style={styles.muted}>Получаем cid через общее API…</Text></View> : <DetailLine label="cid" value={cardDetail?.cid == null ? "не найден" : String(cardDetail.cid)} />}
          <DetailLine label="cardIdInBX" value={String(cardDetail?.cardIdInBX ?? "—")} />
          <DetailLine label="Тип" value={String(cardDetail?.type ?? "—")} />
          <DetailLine label="Номер" value={String(cardDetail?.cardNumberInRestis || cardDetail?.name || "—")} />
          <DetailLine label="Создана" value={String(cardDetail?.created || "—")} />
          <DetailLine label="Статус" value={String(cardDetail?.status || "—")} />
          <PrimaryButton title="Закрыть" onPress={() => setCardDetail(null)} />
        </ScrollView>
      </SafeAreaView></Modal>

      <Modal visible={historyVisible} animationType="slide" onRequestClose={() => setHistoryVisible(false)}><SafeAreaView style={styles.safe}>
        <ScreenHeader title={`История${selectedAccount ? ` · ${selectedAccount.phone}` : ""}`} onClose={() => setHistoryVisible(false)} />
        {historyBusy ? <ActivityIndicator style={styles.loader} color="#F4C35A" size="large" /> :
          <ScrollView contentContainerStyle={styles.historyContent}>
            {historyEntries.length ? historyEntries.map((entry, i) => <View key={`${entry.title}-${i}`} style={styles.historyCard}>
              <Text style={styles.historyCardTitle}>{entry.title}</Text>
              {entry.lines.map((line, j) => <Text key={`${line}-${j}`} style={j === 0 ? styles.historyCardSubtitle : styles.historyCardLine}>{line}</Text>)}
            </View>) : <Text style={styles.historyEmpty}>{historyText || "История пуста"}</Text>}
          </ScrollView>}
      </SafeAreaView></Modal>

      <Modal visible={restaurantVisible} animationType="slide" onRequestClose={() => setRestaurantVisible(false)}><SafeAreaView style={styles.safe}>
        <ScreenHeader title="Выберите ресторан" onClose={() => setRestaurantVisible(false)} />
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Поиск ресторана" placeholderTextColor="#71857A" />
        <FlatList data={filteredRestaurants} keyExtractor={(i, n) => `${i.id}-${i.title}-${n}`} renderItem={({ item }) =>
          <Pressable style={styles.restaurantRow} onPress={() => checkin(item)}><View style={styles.restaurantDot} /><View style={styles.flex}><Text style={styles.restaurantTitle}>{item.title}</Text><Text style={styles.restaurantMeta}>{displayRestaurantKind(item.kind)}</Text></View></Pressable>} />
      </SafeAreaView></Modal>

      <Modal transparent visible={loginVisible} animationType="fade" onRequestClose={() => setLoginVisible(false)}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "position"} contentContainerStyle={styles.flex}>
        <View style={styles.overlay}><View style={styles.sheet}><Text style={styles.sheetTitle}>Вход {selectedAccount?.phone}</Text>
          <TextInput style={styles.input} value={password} onChangeText={v => { setPassword(v); setLoginError(""); }} secureTextEntry placeholder="Пароль" placeholderTextColor="#71857A" />
          {loginError ? <Text style={styles.inlineError}>{loginError}</Text> : null}
          <PrimaryButton title="Войти" onPress={doLogin} /><SecondaryButton title="Отмена" onPress={() => setLoginVisible(false)} />
        </View></View>
      </KeyboardAvoidingView></Modal>

      <Modal transparent visible={addVisible} animationType="fade" onRequestClose={() => setAddVisible(false)}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "position"} contentContainerStyle={styles.flex}>
        <View style={styles.overlay}><View style={styles.sheet}><Text style={styles.sheetTitle}>Добавить аккаунт</Text>
          <TextInput style={styles.input} value={newPhone} onChangeText={v => { setNewPhone(v); setAddError(""); }} keyboardType="phone-pad" placeholder="Номер телефона" placeholderTextColor="#71857A" />
          <TextInput style={styles.input} value={newPassword} onChangeText={v => { setNewPassword(v); setAddError(""); }} secureTextEntry placeholder="Пароль" placeholderTextColor="#71857A" />
          {addError ? <Text style={styles.inlineError}>{addError}</Text> : null}
          <PrimaryButton title={addingAccount ? "Проверяем…" : "Войти и добавить"} onPress={addAccount} loading={addingAccount} />
          <SecondaryButton title="Отмена" onPress={() => setAddVisible(false)} />
        </View></View>
      </KeyboardAvoidingView></Modal>

      <Modal transparent visible={dialog !== null} animationType="fade" onRequestClose={() => setDialog(null)}>
        <Pressable style={styles.dialogBackdrop} onPress={() => setDialog(null)}><Pressable style={styles.dialogCard} onPress={() => {}}>
          <View style={styles.dialogHeader}><Text style={styles.dialogTitle}>{dialog?.title}</Text><Pressable style={styles.dialogClose} onPress={() => setDialog(null)}><Text style={styles.dialogCloseText}>×</Text></Pressable></View>
          {dialog?.message ? <Text style={styles.dialogMessage}>{dialog.message}</Text> : null}
          <View style={styles.dialogActions}>{dialog?.actions.map(action => <Pressable key={action.label} style={[styles.dialogButton, action.kind === "secondary" && styles.dialogSecondary, action.kind === "danger" && styles.dialogDanger]} onPress={() => { setDialog(null); if (action.onPress) void action.onPress(); }}>
            <Text style={[styles.dialogButtonText, action.kind === "secondary" && styles.dialogSecondaryText, action.kind === "danger" && styles.dialogDangerText]}>{action.label}</Text>
          </Pressable>)}</View>
        </Pressable></Pressable>
      </Modal>
      </SafeAreaView>
    </Animated.View>
  </View>;
}

function PrimaryButton({ title, onPress, loading = false }: { title: string; onPress: () => void | Promise<void>; loading?: boolean }) {
  return <Pressable style={styles.primaryButton} onPress={() => void onPress()} disabled={loading}>{loading ? <ActivityIndicator color="#172018" /> : <Text style={styles.primaryButtonText}>{title}</Text>}</Pressable>;
}
function SecondaryButton({ title, onPress, danger = false, compact = false }: { title: string; onPress: () => void | Promise<void>; danger?: boolean; compact?: boolean }) {
  return <Pressable style={[styles.secondaryButton, compact && styles.secondaryCompact, danger && styles.dangerButton]} onPress={() => void onPress()}><Text style={[styles.secondaryButtonText, danger && styles.dangerButtonText]}>{title}</Text></Pressable>;
}
function CardButton({ title, onPress }: { title: string; onPress: () => void | Promise<void> }) {
  return <Pressable style={styles.cardButton} onPress={() => void onPress()}><Text style={styles.cardButtonText}>{title}</Text></Pressable>;
}
function ScreenHeader({ title, onClose, back = false }: { title: string; onClose: () => void; back?: boolean }) {
  return <View style={styles.screenHeader}><Pressable style={styles.screenCloseButton} onPress={onClose}><Text style={styles.screenCloseText}>{back ? "‹" : "×"}</Text></Pressable><Text style={styles.screenTitle} numberOfLines={1}>{title}</Text><View style={styles.screenHeaderSpacer} /></View>;
}
function SettingsRow({ title, onPress }: { title: string; onPress: () => void }) {
  return <Pressable style={styles.settingsRow} onPress={onPress}><Text style={styles.settingsRowTitle}>{title}</Text><Text style={styles.settingsArrow}>›</Text></Pressable>;
}
function ProfileField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <View><Text style={styles.fieldLabel}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChange} /></View>;
}
function ChoiceButton({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) {
  return <Pressable style={[styles.choiceButton, active && styles.choiceActive]} onPress={onPress}><Text style={[styles.choiceText, active && styles.choiceActiveText]}>{title}</Text></Pressable>;
}
function DetailLine({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailLine}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#081310" }, flex: { flex: 1 },
  startup: { flex: 1, backgroundColor: "#081310", alignItems: "center", justifyContent: "center" },
  mainHeader: { paddingTop: 46, paddingHorizontal: 18, paddingBottom: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  squareHeaderButton: { width: 48, height: 46, borderRadius: 15, borderWidth: 1, borderColor: "#36533F", backgroundColor: "#102019", alignItems: "center", justifyContent: "center", gap: 5 },
  menuLine: { width: 23, height: 2.5, borderRadius: 2, backgroundColor: "#F4C35A" },
  headerRefresh: { color: "#F4C35A", fontSize: 29, fontWeight: "700", lineHeight: 31 }, disabledText: { opacity: 0.35 },
  refreshSlot: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  settingsVersion: { color: "#71857A", textAlign: "center", marginTop: 12, fontSize: 12 },
  logList: { paddingBottom: 24 },
  logRow: { paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#1D3328" },
  logTime: { color: "#71857A", fontSize: 12, marginBottom: 4 },
  logMessage: { color: "#E8EFEA", fontSize: 14, lineHeight: 20 },
  customBrandLogo: { width: 230, height: 76 },
  content: { paddingHorizontal: 14, paddingBottom: 21 }, accountItem: { paddingBottom: 9 }, dragActive: { zIndex: 30, elevation: 16 }, emptyCard: { backgroundColor: "#102019", borderRadius: 18, borderWidth: 1, borderColor: "#294536", padding: 17 },
  emptyTitle: { color: "#F5F7F5", fontSize: 18, fontWeight: "900" }, muted: { color: "#81958A", fontSize: 12, marginTop: 4 },
  accountCard: { backgroundColor: "#102019", borderRadius: 19, borderWidth: 1, borderColor: "#2C503C", overflow: "hidden" }, accountMain: { paddingHorizontal: 13, paddingVertical: 11 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, phone: { color: "#F5F7F5", fontSize: 15, fontWeight: "900" }, reload: { color: "#E6B44B", fontSize: 21 },
  compactStats: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 10, marginTop: 9 },
  compactMetric: { flex: 1, alignItems: "flex-end" }, statLabel: { color: "#789084", fontSize: 10 }, bonus: { color: "#F4C35A", fontSize: 22, fontWeight: "900", marginTop: 1 },
  metricValue: { color: "#E9EEE9", fontSize: 13, fontWeight: "800", marginTop: 2 },
  checkinCode: { color: "#DDE8E1", fontSize: 11, fontWeight: "800", marginTop: 8 },
  checkinTimer: { color: "#F4C35A", fontSize: 11, fontWeight: "800", marginTop: 4 }, updated: { color: "#70857A", fontSize: 10, marginTop: 5 },
  cardActions: { flexDirection: "row", gap: 6, padding: 6, borderTopWidth: 1, borderTopColor: "#253B30", backgroundColor: "#0D1A15" },
  cardButton: { flex: 1, minHeight: 36, borderRadius: 10, backgroundColor: "#173025", alignItems: "center", justifyContent: "center", paddingHorizontal: 7 }, cardButtonText: { color: "#DDE8E1", fontSize: 12, fontWeight: "900" },
  version: { color: "#607267", textAlign: "center", marginTop: 7, paddingBottom: 6 },
  primaryButton: { minHeight: 46, width: "100%", borderRadius: 14, backgroundColor: "#E6B44B", alignItems: "center", justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10 },
  primaryButtonText: { color: "#172018", fontWeight: "900", fontSize: 14, textAlign: "center" },
  secondaryButton: { minHeight: 42, flex: 1, borderRadius: 12, backgroundColor: "#173025", borderWidth: 1, borderColor: "#294536", alignItems: "center", justifyContent: "center", paddingHorizontal: 12, paddingVertical: 9 },
  secondaryCompact: { minHeight: 32, paddingVertical: 5, paddingHorizontal: 8 }, secondaryButtonText: { color: "#DDE8E1", fontWeight: "900", fontSize: 12 }, dangerButton: { backgroundColor: "#32191A", borderColor: "#61302F" }, dangerButtonText: { color: "#F2A7A7" },
  screenHeader: { paddingTop: 46, paddingHorizontal: 16, paddingBottom: 17, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#20352A" },
  screenCloseButton: { width: 44, height: 42, borderRadius: 13, backgroundColor: "#102019", borderWidth: 1, borderColor: "#36533F", alignItems: "center", justifyContent: "center" },
  screenCloseText: { color: "#F4C35A", fontSize: 29, lineHeight: 31, fontWeight: "600" }, screenTitle: { flex: 1, color: "#F4C35A", fontSize: 22, fontWeight: "900", textAlign: "center", marginHorizontal: 8 }, screenHeaderSpacer: { width: 44 },
  settingsContent: { padding: 16, gap: 11 },
  appearanceContent: { padding: 16, gap: 12, paddingBottom: 32 }, appearanceCard: { backgroundColor: "#102019", borderWidth: 1, borderColor: "#294536", borderRadius: 17, padding: 15, gap: 10 }, appearanceTitle: { color: "#F4C35A", fontSize: 16, fontWeight: "900" }, appearanceNote: { color: "#9FB0A6", fontSize: 12, lineHeight: 17 }, appearancePreview: { width: "100%", height: 90, backgroundColor: "#081310", borderRadius: 12 }, iconPreview: { width: 72, height: 72, borderRadius: 16, alignSelf: "center" }, settingsRow: { minHeight: 70, borderRadius: 17, backgroundColor: "#102019", borderWidth: 1, borderColor: "#294536", paddingHorizontal: 17, paddingVertical: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  settingsRowTitle: { color: "#F5F7F5", fontSize: 17, fontWeight: "900" }, settingsArrow: { color: "#E6B44B", fontSize: 28 }, listContent: { padding: 16, gap: 7, paddingBottom: 30 }, emptyListText: { color: "#81958A", textAlign: "center", paddingTop: 30 },
  pinnedAdd: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }, manageCard: { backgroundColor: "#102019", borderRadius: 13, borderWidth: 1, borderColor: "#294536", paddingHorizontal: 10, paddingVertical: 7, gap: 5 },
  managePhone: { color: "#F5F7F5", fontSize: 14, fontWeight: "900" }, manageButtons: { flexDirection: "row", gap: 6 },
  toolbar: { paddingHorizontal: 16, paddingTop: 13, paddingBottom: 11 }, searchInput: { marginHorizontal: 16, marginBottom: 10, backgroundColor: "#0B1712", borderWidth: 1, borderColor: "#2D4B3A", borderRadius: 14, color: "#FFFFFF", paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  input: { backgroundColor: "#0B1712", borderWidth: 1, borderColor: "#2D4B3A", borderRadius: 14, color: "#FFFFFF", paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  inlineError: { color: "#F2A7A7", backgroundColor: "#32191A", borderRadius: 11, borderWidth: 1, borderColor: "#61302F", paddingHorizontal: 12, paddingVertical: 9, fontSize: 12, lineHeight: 17 },
  restaurantRow: { minHeight: 60, paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1C3127", flexDirection: "row", alignItems: "center" }, restaurantDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#E6B44B", marginRight: 13 },
  restaurantTitle: { color: "#F4F6F4", fontSize: 14, fontWeight: "700" }, restaurantMeta: { color: "#71857A", fontSize: 11, marginTop: 3 },
  aliasCard: { marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 17, backgroundColor: "#102019", borderWidth: 1, borderColor: "#355541", gap: 10 }, aliasHeader: { flexDirection: "row", alignItems: "flex-start" },
  aliasClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#21372C", alignItems: "center", justifyContent: "center", marginRight: 10 }, aliasCloseText: { color: "#F4C35A", fontSize: 27, lineHeight: 29 },
  aliasTitle: { color: "#F4C35A", fontSize: 16, fontWeight: "900" }, aliasCaption: { color: "#9FB0A6", fontSize: 12, marginTop: 3 },
  typeCard: { backgroundColor: "#102019", borderWidth: 1, borderColor: "#294536", borderRadius: 16, padding: 11, flexDirection: "row", alignItems: "center", gap: 11 }, typeImage: { width: 70, height: 46, borderRadius: 8, backgroundColor: "#0B1712" }, typeTitle: { color: "#F5F7F5", fontWeight: "800", fontSize: 14 }, loader: { marginTop: 42 },
  profileContent: { padding: 16, gap: 11, paddingBottom: 40 }, fieldLabel: { color: "#8FA197", fontSize: 11, marginBottom: 5 }, genderRow: { flexDirection: "row", gap: 8 },
  choiceButton: { flex: 1, minHeight: 43, borderRadius: 12, backgroundColor: "#173025", borderWidth: 1, borderColor: "#294536", alignItems: "center", justifyContent: "center" }, choiceActive: { backgroundColor: "#E6B44B", borderColor: "#E6B44B" }, choiceText: { color: "#DDE8E1", fontWeight: "900" }, choiceActiveText: { color: "#172018" },
  profileMeta: { backgroundColor: "#102019", borderRadius: 14, padding: 13 }, sectionTitle: { color: "#F4C35A", fontSize: 18, fontWeight: "900", marginTop: 9 },
  userCardCompact: { minHeight: 52, backgroundColor: "#102019", borderWidth: 1, borderColor: "#294536", borderRadius: 14, padding: 6, flexDirection: "row", alignItems: "center", gap: 9 },
  cardThumb: { width: 66, height: 38, borderRadius: 6, backgroundColor: "#0B1712" }, cardThumbPlaceholder: { width: 66, height: 38, borderRadius: 6, backgroundColor: "#173025" }, cardTitle: { color: "#F5F7F5", fontWeight: "900", fontSize: 12, flex: 1 },
  detailContent: { padding: 16, gap: 11, paddingBottom: 40 }, detailImage: { width: "100%", height: 150, backgroundColor: "#102019", borderRadius: 16 }, detailTitle: { color: "#F4C35A", fontSize: 20, fontWeight: "900" },
  detailLine: { backgroundColor: "#102019", borderRadius: 13, borderWidth: 1, borderColor: "#294536", padding: 12, flexDirection: "row", justifyContent: "space-between", gap: 14 }, detailLabel: { color: "#81958A", fontSize: 12 }, detailValue: { color: "#F5F7F5", fontSize: 12, fontWeight: "800", flexShrink: 1, textAlign: "right" }, cidLoading: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#102019", padding: 12, borderRadius: 13 },
  historyContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 34, gap: 7 }, historyCard: { backgroundColor: "#102019", borderWidth: 1, borderColor: "#294536", borderRadius: 14, paddingHorizontal: 11, paddingVertical: 9 },
  historyCardTitle: { color: "#F4C35A", fontSize: 14, fontWeight: "900" }, historyCardSubtitle: { color: "#F5F7F5", fontSize: 12, fontWeight: "800", marginTop: 3 }, historyCardLine: { color: "#B8C7BE", fontSize: 12, lineHeight: 16, marginTop: 1 }, historyEmpty: { color: "#B8C7BE", fontSize: 13, lineHeight: 19 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.76)", justifyContent: "flex-end" }, sheet: { backgroundColor: "#102019", padding: 20, borderTopLeftRadius: 26, borderTopRightRadius: 26, gap: 11, borderTopWidth: 1, borderColor: "#355541" }, sheetTitle: { color: "#F4C35A", fontSize: 20, fontWeight: "900" },
  dialogBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.78)", justifyContent: "center", paddingHorizontal: 24 }, dialogCard: { borderRadius: 20, backgroundColor: "#102019", borderWidth: 1, borderColor: "#355541", padding: 17 },
  dialogHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, dialogTitle: { color: "#F4C35A", fontSize: 19, fontWeight: "900", flex: 1 }, dialogClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#21372C", alignItems: "center", justifyContent: "center" }, dialogCloseText: { color: "#F4C35A", fontSize: 25, lineHeight: 27 },
  dialogMessage: { color: "#D9E2DC", fontSize: 14, lineHeight: 20, marginTop: 12 }, dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 18 }, dialogButton: { minWidth: 102, minHeight: 42, borderRadius: 12, backgroundColor: "#E6B44B", alignItems: "center", justifyContent: "center", paddingHorizontal: 13 },
  dialogSecondary: { backgroundColor: "#173025", borderWidth: 1, borderColor: "#294536" }, dialogDanger: { backgroundColor: "#32191A", borderWidth: 1, borderColor: "#61302F" }, dialogButtonText: { color: "#172018", fontWeight: "900", fontSize: 13 }, dialogSecondaryText: { color: "#DDE8E1" }, dialogDangerText: { color: "#F2A7A7" },
});
