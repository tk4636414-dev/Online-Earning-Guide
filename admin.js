import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
    getAuth, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
    initializeFirestore, 
    collection, 
    doc, 
    getDoc, 
    getDocs, 
    getCountFromServer,
    addDoc, 
    setDoc, 
    updateDoc, 
    deleteDoc, 
    onSnapshot, 
    serverTimestamp, 
    query, 
    where,
    limit,
    orderBy,
    startAfter,
    documentId,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { 
    getStorage, 
    ref, 
    uploadBytes, 
    getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// 1. Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCvfVVux-LOfAg26vSd9ZK2QsMj1w2nt0c",
    authDomain: "ai-article-b3954.firebaseapp.com",
    projectId: "ai-article-b3954",
    storageBucket: "ai-article-b3954.firebasestorage.app",
    messagingSenderId: "1037653329427",
    appId: "1:1037653329427:web:b843e2582a9743ac8c21e6"
};

// 2. Firebase Init
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const storage = getStorage(app);
const db = initializeFirestore(app, {
    experimentalForceLongPolling: true
});

let activeListeners = [];
const loadedAdminViews = new Set();
let articleDocuments = [];
let userDocuments = [];
let userPresence = new Map();
let currentSubscriptionRequestId = "";
let currentAdminUid = "";
let articleFilterEmptyState = null;
const PAGE_SIZE = 50;
let articleCursor = null;
let articleHasMore = true;
let articleLoading = false;
let userCursor = null;
let userHasMore = true;
let userLoading = false;
let messageDocuments = [];
let messageCursor = null;
let messageHasMore = true;
let messageLoading = false;
let auditDocuments = [];
let auditCursor = null;
let auditHasMore = true;
let auditLoading = false;
const userAccessOverrides = new Map();
let recipientLookupTimer = null;

function registerListener(unsubscribeFn) {
    if (typeof unsubscribeFn === "function") {
        activeListeners.push(unsubscribeFn);
    }
}

function unsubscribeAll() {
    const listenersToStop = activeListeners;
    activeListeners = [];

    for (const unsubscribeFn of listenersToStop) {
        try {
            unsubscribeFn();
        } catch (error) {
            console.error("Firestore listener cleanup error:", error);
        }
    }
}

// 3. Real Backend Verification & Dynamic Loading
function renderAuthState({ isLoggedIn, isAdmin, isLoading }) {
    const loginScreen = document.getElementById("login-screen");
    const adminApp = document.getElementById("admin-app");
    const loadingSpinner = document.getElementById("loadingSpinner");
    const accessStatus = document.getElementById("access-status");

    const hasAdminAccess = isLoggedIn && isAdmin;

    if (loginScreen) {
        loginScreen.hidden = hasAdminAccess || isLoading;
        loginScreen.style.display = hasAdminAccess || isLoading ? "none" : "flex";
    }

    if (adminApp) {
        adminApp.hidden = !hasAdminAccess;
        adminApp.style.display = hasAdminAccess ? "grid" : "none";
    }

    if (loadingSpinner) {
        loadingSpinner.hidden = !isLoading;
        loadingSpinner.style.display = isLoading ? "flex" : "none";
    }

    if (accessStatus) {
        if (isLoading || !isLoggedIn) {
            accessStatus.textContent = "Checking access...";
        } else {
            accessStatus.textContent = isAdmin ? "Access Granted" : "Access Denied";
        }
    }
}

onAuthStateChanged(auth, async (user) => {
    try {
        unsubscribeAll();
        loadedAdminViews.clear();
        userAccessOverrides.clear();

        if (!user) {
            currentAdminUid = "";
            renderAuthState({ isLoggedIn: false, isAdmin: false, isLoading: false });
            return;
        }

        renderAuthState({ isLoggedIn: true, isAdmin: false, isLoading: true });

        const tokenResult = await user.getIdTokenResult(true);
        const isAdmin = tokenResult.claims && tokenResult.claims.admin === true;

        console.log("🔥 Asli Admin Claim Status:", isAdmin);

        if (isAdmin) {
            currentAdminUid = user.uid;
            renderAuthState({ isLoggedIn: true, isAdmin: true, isLoading: false });
            const adminEmail = document.getElementById("admin-email");
            if (adminEmail) adminEmail.textContent = user.email || "Administrator";

            loadedAdminViews.add("dashboard");
            loadViewData("articles");
            loadViewData("users");
            loadViewData("audit");
            loadDashboardListeners();
            return;
        }

        renderAuthState({ isLoggedIn: true, isAdmin: false, isLoading: false });
        showToast("Access Denied! Aap ke account ke paas backend se Admin Claims nahi hain.", "error");
        await signOut(auth);
    } catch (error) {
        console.error("Auth error:", error);
        unsubscribeAll();
        loadedAdminViews.clear();
        renderAuthState({ isLoggedIn: false, isAdmin: false, isLoading: false });
        showFirebaseError(error, "Could not verify admin access.");
    }
});
// 4. Google Login
const loginBtn = document.getElementById("admin-login");
if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            showToast("Login Error: " + error.message, "error");
        }
    });
}

// 5. Logout
const logoutBtn = document.getElementById("admin-logout");
if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
        unsubscribeAll();
        try {
            await signOut(auth);
        } catch (error) {
            showFirebaseError(error, "Could not sign out.");
        }
    });
}

function showToast(message, type = "info") {
    const toastRegion = document.getElementById("toast-region");
    if (!toastRegion) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type} show`;
    toast.textContent = message;
    toastRegion.replaceChildren(toast);
    setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

function escapeHTML(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function setListState(container, message) {
    const state = document.createElement("p");
    state.className = "empty-state";
    state.textContent = message;
    container.replaceChildren(state);
}

function showFirebaseError(error, fallbackMessage) {
    console.error(fallbackMessage, error);
    if (error?.code === "permission-denied" || error?.code === "firestore/permission-denied") {
        showToast("Missing or insufficient permissions: Admin authorization required.", "error");
        return;
    }
    showToast(fallbackMessage, "error");
}

async function writeAuditEvent(action, detail) {
    try {
        await addDoc(collection(db, "audit_trail"), {
            action,
            detail: String(detail || ""),
            actorUid: auth.currentUser?.uid || "",
            actorEmail: auth.currentUser?.email || "",
            createdAt: serverTimestamp()
        });
    } catch (error) {
        showFirebaseError(error, "The action completed, but its audit event could not be recorded.");
    }
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isRecentlyActive(userId) {
    const lastSeen = userPresence.get(userId)?.lastSeen;
    const lastSeenMs = lastSeen?.toMillis?.();
    const ageMs = Date.now() - lastSeenMs;
    return Number.isFinite(lastSeenMs) && ageMs >= 0 && ageMs <= 5 * 60 * 1000;
}

function sanitizeText(value) {
    return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function validateImageFile(file) {
    if (!file) return { valid: true, message: "" };

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    const maxBytes = 2 * 1024 * 1024;

    if (!allowedTypes.includes(file.type)) {
        return { valid: false, message: "Only JPG, PNG, or WEBP images are allowed." };
    }

    if (file.size > maxBytes) {
        return { valid: false, message: "Image must be smaller than 2MB." };
    }

    return { valid: true, message: "" };
}

// 6. Fetch Pending Subscription Requests
function loadSubscriptionRequests() {
    const container = document.getElementById("subscription-requests-list");
    if (!container) return;

    setListState(container, "Loading subscription requests...");

    try {
        const unsubscribe = onSnapshot(collection(db, "subscriptionRequests"), (snapshot) => {
            try {
                if (snapshot.empty) {
                    setListState(container, "No pending subscription requests.");
                    return;
                }

                const cards = snapshot.docs.map((docSnap) => {
                    const data = docSnap.data();
                    const card = document.createElement("div");
                    card.style.cssText = "padding: 12px; border: 1px solid #444; margin-bottom: 10px; border-radius: 6px; background: #222; color: #fff;";

                    const addDetail = (label, value) => {
                        const row = document.createElement("p");
                        row.style.margin = "3px 0";
                        const strong = document.createElement("strong");
                        strong.textContent = `${label}: `;
                        row.append(strong, document.createTextNode(String(value)));
                        card.appendChild(row);
                    };

                    addDetail("Gmail", data.email || "N/A");
                    addDetail("Plan", data.plan || "N/A");
                    addDetail("Payment method", data.paymentMethod || "N/A");
                    addDetail("TrxID", data.trxId || data.transactionId || "N/A");
                    addDetail("Status", data.status || "pending");
                    addDetail("Amount", data.amount == null ? "Enter in activation form" : `Rs. ${data.amount}`);

                    const actions = document.createElement("div");
                    actions.style.cssText = "margin-top: 8px; display: flex; gap: 8px;";

                    const approveBtn = document.createElement("button");
                    approveBtn.type = "button";
                    approveBtn.textContent = "Review";
                    approveBtn.style.cssText = "background: #28a745; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;";
                    approveBtn.addEventListener("click", async () => {
                        await window.approveRequest(docSnap.id, data.email || "", data.trxId || data.transactionId || "", data.amount || 0);
                    });

                    const rejectBtn = document.createElement("button");
                    rejectBtn.type = "button";
                    rejectBtn.textContent = "Reject";
                    rejectBtn.style.cssText = "background: #dc3545; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;";
                    rejectBtn.addEventListener("click", async () => {
                        await window.rejectRequest(docSnap.id);
                    });

                    actions.append(approveBtn, rejectBtn);
                    card.appendChild(actions);
                    return card;
                });

                container.replaceChildren(...cards);
            } catch (error) {
                console.error("Subscription request rendering error:", error);
                setListState(container, "Could not display subscription requests.");
                showFirebaseError(error, "Could not display subscription requests.");
            }
        }, (error) => {
            console.error("Subscription request loading error:", error);
            setListState(container, "Could not load subscription requests.");
            showFirebaseError(error, "Could not load subscription requests.");
        });

        registerListener(unsubscribe);
    } catch (error) {
        console.error("Subscription request setup error:", error);
        setListState(container, "Could not load subscription requests.");
        showFirebaseError(error, "Could not load subscription requests.");
    }
}

// 7. Auto-Fill Details from Pending List
window.approveRequest = async (id, email, trxId, amount) => {
    const emailInput = document.getElementById("subscription-email");
    const tidInput = document.getElementById("subscription-tid");
    const amountInput = document.getElementById("subscription-amount");

    if (emailInput) emailInput.value = email;
    if (tidInput) tidInput.value = trxId;
    if (amountInput) amountInput.value = Number(amount) > 0 ? String(amount) : "";
    currentSubscriptionRequestId = id;
    showToast("Request details filled. Activate the subscription to complete approval.", "success");
};

// 8. Reject Request
window.rejectRequest = async (id) => {
    if (confirm("Delete this request?")) {
        try {
            await deleteDoc(doc(db, "subscriptionRequests", id));
            if (currentSubscriptionRequestId === id) currentSubscriptionRequestId = "";
            await writeAuditEvent("Subscription request rejected", id);
            showToast("Request removed.", "success");
        } catch (err) {
            showFirebaseError(err, "Could not reject this subscription request.");
        }
    }
};

// ==========================================
// ARTICLE UPLOAD FUNCTION (COMPLETE WITH ALL FIELDS)
// ==========================================
const articleForm = document.getElementById("article-form");

if (articleForm) {
    articleForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const titleInput = document.getElementById("article-title");
        const categoryInput = document.getElementById("article-category");
        const tagsInput = document.getElementById("article-tags");
        const descriptionInput = document.getElementById("article-description");
        const contentInput = document.getElementById("article-content");
        const statusInput = document.getElementById("article-status");
        const imageInput = document.getElementById("article-image");
        const articleIdInput = document.getElementById("article-id");
        if (!titleInput || !categoryInput || !tagsInput || !descriptionInput || !contentInput || !statusInput || !imageInput || !articleIdInput) {
            showToast("Article form is incomplete.", "error");
            return;
        }

        const title = sanitizeText(titleInput.value);
        const category = sanitizeText(categoryInput.value);
        const tags = sanitizeText(tagsInput.value);
        const description = sanitizeText(descriptionInput.value);
        const content = sanitizeText(contentInput.value);
        const status = sanitizeText(statusInput.value);
        const imageFile = imageInput.files?.[0];
        const submitBtn = articleForm.querySelector("button[type='submit']");

        if (!title || !category || !content) {
            showToast("Title, category, and content are required.", "error");
            return;
        }

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerText = "Saving article...";
            }

            let imageUrl = editingImageUrl;

            if (imageFile) {
                const imageValidation = validateImageFile(imageFile);
                if (!imageValidation.valid) {
                    throw new Error(imageValidation.message);
                }

                const safeFileName = imageFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
                const storageRef = ref(storage, `article-images/${auth.currentUser.uid}/${Date.now()}_${safeFileName}`);
                await uploadBytes(storageRef, imageFile);
                imageUrl = await getDownloadURL(storageRef);
            }

            const articleId = articleIdInput.value;
            const articleData = {
                title: title,
                category: category,
                tags: tags,
                description: description,
                content: content,
                status: status,
                imageUrl: imageUrl,
                updatedAt: serverTimestamp()
            };
            if (articleId) {
                await updateDoc(doc(db, "articles", articleId), articleData);
            } else {
                await addDoc(collection(db, "articles"), {
                    ...articleData,
                    createdAt: serverTimestamp()
                });
            }
            await writeAuditEvent(articleId ? "Article updated" : "Article created", title);
            await refreshArticleCount();
            if (loadedAdminViews.has("articles")) loadArticles();

            showToast(articleId ? "Article updated successfully." : "Article created successfully.", "success");
            articleForm.reset();
            editingImageUrl = "";
            articleDialog?.close();

        } catch (error) {
            showFirebaseError(error, "Could not save the article.");
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = "Save article";
            }
        }
    });
}

function applyArticleFilters() {
    const container = document.getElementById("article-list");
    const searchInput = document.getElementById("article-search");
    const filterSelect = document.getElementById("article-filter");
    if (!container || !searchInput || !filterSelect) return;

    const searchTerm = searchInput.value.trim().toLowerCase();
    const selectedStatus = filterSelect.value;
    let visibleCount = 0;

    for (const card of container.children) {
        if (!card.dataset.searchText) continue;
        const matchesSearch = card.dataset.searchText.includes(searchTerm);
        const matchesStatus = selectedStatus === "all" || card.dataset.status === selectedStatus;
        card.hidden = !(matchesSearch && matchesStatus);
        if (!card.hidden) visibleCount += 1;
    }

    if (visibleCount === 0 && container.querySelector("[data-search-text]")) {
        if (!articleFilterEmptyState) {
            articleFilterEmptyState = document.createElement("p");
            articleFilterEmptyState.className = "empty-state";
        }
        articleFilterEmptyState.textContent = "No articles match these filters.";
        container.appendChild(articleFilterEmptyState);
    } else if (articleFilterEmptyState) {
        articleFilterEmptyState.remove();
        articleFilterEmptyState = null;
    }
}

function renderArticleDocuments(documents, replace = false) {
    const container = document.getElementById("article-list");
    if (!container) return;
    try {
        if (!documents.length && replace) {
            setListState(container, "No articles found.");
            return;
        }

        const cards = documents.map((docSnap) => {
                    const data = docSnap.data();
                    const card = document.createElement("div");
                    card.style.cssText = "background: #111; border: 1px solid #333; border-radius: 10px; padding: 12px; margin-bottom: 12px; color: #fff;";
                    card.dataset.status = String(data.status || "draft");
                    card.dataset.searchText = [data.title, data.category, data.tags, data.description]
                        .map((value) => String(value || ""))
                        .join(" ")
                        .toLowerCase();

                    if (data.imageUrl) {
                        try {
                            const imageUrl = new URL(data.imageUrl, window.location.href);
                            if (["http:", "https:"].includes(imageUrl.protocol)) {
                                const image = document.createElement("img");
                                image.src = imageUrl.href;
                                image.alt = String(data.title || "Article image");
                                image.style.cssText = "width: 100%; max-height: 180px; object-fit: cover; border-radius: 8px; margin-bottom: 10px;";
                                card.appendChild(image);
                            }
                        } catch {}
                    }

                    const title = document.createElement("h4");
                    title.textContent = String(data.title || "Untitled Article");

                    const category = document.createElement("p");
                    const categoryLabel = document.createElement("strong");
                    categoryLabel.textContent = "Category: ";
                    category.append(categoryLabel, document.createTextNode(String(data.category || "Uncategorized")));

                    const status = document.createElement("p");
                    const statusLabel = document.createElement("strong");
                    statusLabel.textContent = "Status: ";
                    status.append(statusLabel, document.createTextNode(String(data.status || "draft")));

                    const description = document.createElement("p");
                    description.textContent = String(data.description || "").slice(0, 140);

                    const actions = document.createElement("div");
                    actions.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px;";

                    const editBtn = document.createElement("button");
                    editBtn.type = "button";
                    editBtn.textContent = "Edit";
                    editBtn.style.cssText = "padding: 8px 12px; border: none; background: #ffc107; color: #000; border-radius: 6px; cursor: pointer;";
                    editBtn.addEventListener("click", () => {
                        if (typeof window.editArticle === "function") {
                            window.editArticle(docSnap.id);
                        }
                    });

                    const deleteBtn = document.createElement("button");
                    deleteBtn.type = "button";
                    deleteBtn.textContent = "Delete";
                    deleteBtn.style.cssText = "padding: 8px 12px; border: none; background: #dc3545; color: #fff; border-radius: 6px; cursor: pointer;";
                    deleteBtn.addEventListener("click", () => {
                        if (typeof window.deleteArticle === "function") {
                            window.deleteArticle(docSnap.id);
                        }
                    });

                    actions.append(editBtn, deleteBtn);
                    card.append(title, category, status, description, actions);
                    return card;
                });

        if (replace) container.replaceChildren(...cards);
        else container.append(...cards);
        applyArticleFilters();
    } catch (error) {
        console.error("Article rendering error:", error);
        setListState(container, "Could not display articles.");
        showFirebaseError(error, "Could not display articles.");
    }
}

async function loadMoreArticles() {
    const container = document.getElementById("article-list");
    const button = document.getElementById("load-more-articles");
    if (!container || articleLoading || !articleHasMore) return;

    articleLoading = true;
    if (button) button.disabled = true;
    try {
        const constraints = [orderBy(documentId())];
        if (articleCursor) constraints.push(startAfter(articleCursor));
        constraints.push(limit(PAGE_SIZE));
        const snapshot = await getDocs(query(collection(db, "articles"), ...constraints));
        articleCursor = snapshot.docs.at(-1) || articleCursor;
        articleHasMore = snapshot.size === PAGE_SIZE;
        renderArticleDocuments(snapshot.docs, articleDocuments.length === 0);
        articleDocuments.push(...snapshot.docs);
        if (button) button.hidden = !articleHasMore;
    } catch (error) {
        console.error("Article page loading error:", error);
        if (!articleDocuments.length) setListState(container, "Could not load articles.");
        showFirebaseError(error, "Could not load articles.");
    } finally {
        articleLoading = false;
        if (button) button.disabled = false;
    }
}

function loadArticles() {
    const container = document.getElementById("article-list");
    if (!container) return;
    articleDocuments = [];
    articleCursor = null;
    articleHasMore = true;
    setListState(container, "Loading articles...");
    const button = document.getElementById("load-more-articles");
    if (button) button.hidden = true;
    loadMoreArticles();
}

function renderUserDirectory() {
    const container = document.getElementById("user-list");
    const searchInput = document.getElementById("user-search");
    const filterSelect = document.getElementById("user-filter");
    if (!container || !searchInput || !filterSelect) return;
    if (userDocuments.length === 0) {
        setListState(container, "No users found.");
        return;
    }

    const searchTerm = searchInput.value.trim().toLowerCase();
    const selectedFilter = filterSelect.value;
    const visibleUsers = userDocuments.filter((userDoc) => {
        const user = { ...userDoc.data(), ...userAccessOverrides.get(userDoc.id) };
        const searchableText = `${user.displayName || ""} ${user.email || ""}`.toLowerCase();
        const isAdmin = userDoc.id === currentAdminUid
            || user.isAdmin === true
            || user.admin === true
            || user.role === "admin";
        const matchesFilter = selectedFilter === "all"
            || (selectedFilter === "active" && isRecentlyActive(userDoc.id))
            || (selectedFilter === "admin" && isAdmin);
        return searchableText.includes(searchTerm) && matchesFilter;
    });

    if (visibleUsers.length === 0) {
        setListState(container, "No users match these filters.");
        return;
    }

    const rows = visibleUsers.map((userDoc) => {
        const user = { ...userDoc.data(), ...userAccessOverrides.get(userDoc.id) };
        const row = document.createElement("article");
        row.className = "user-row";

        const details = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = String(user.displayName || "Unnamed user");
        const email = document.createElement("p");
        email.textContent = String(user.email || "No email provided");
        details.append(name, email);

        const status = document.createElement("p");
        status.textContent = user.accessDisabled
            ? "Access disabled"
            : user.isPremium
                ? "Premium"
                : "Free";

        const isProtectedAdmin = userDoc.id === currentAdminUid
            || user.admin === true
            || user.isAdmin === true
            || user.role === "admin";
        const accessButton = document.createElement("button");
        accessButton.type = "button";
        accessButton.className = "button button-ghost";
        accessButton.textContent = user.accessDisabled ? "Reactivate" : "Suspend";
        accessButton.disabled = isProtectedAdmin;
        accessButton.setAttribute(
            "aria-label",
            `${user.accessDisabled ? "Reactivate" : "Suspend"} ${user.email || "user"}`
        );
        accessButton.addEventListener("click", () => toggleUserAccess(userDoc, user));

        const actions = document.createElement("div");
        actions.className = "row-actions";
        actions.appendChild(accessButton);
        row.append(details, status, actions);
        return row;
    });
    container.replaceChildren(...rows);
}

async function loadMoreUsers() {
    const container = document.getElementById("user-list");
    const button = document.getElementById("load-more-users");
    if (!container || userLoading || !userHasMore) return;
    userLoading = true;
    if (button) button.disabled = true;
    try {
        const constraints = [orderBy("email")];
        if (userCursor) constraints.push(startAfter(userCursor));
        constraints.push(limit(PAGE_SIZE));
        const snapshot = await getDocs(query(collection(db, "users"), ...constraints));
        userDocuments.push(...snapshot.docs);
        userCursor = snapshot.docs.at(-1) || userCursor;
        userHasMore = snapshot.size === PAGE_SIZE;
        renderUserDirectory();
        if (button) button.hidden = !userHasMore;
    } catch (error) {
        console.error("User page loading error:", error);
        if (!userDocuments.length) setListState(container, "Could not load users.");
        showFirebaseError(error, "Could not load users.");
    } finally {
        userLoading = false;
        if (button) button.disabled = false;
    }
}

function loadUsers() {
    const container = document.getElementById("user-list");
    if (!container) return;
    userDocuments = [];
    userCursor = null;
    userHasMore = true;
    setListState(container, "Loading users...");
    const button = document.getElementById("load-more-users");
    if (button) button.hidden = true;
    loadMoreUsers();
}

async function toggleUserAccess(userDoc, user) {
    const disabling = user.accessDisabled !== true;
    if (disabling && !window.confirm(`Suspend access for ${user.email || "this user"}?`)) return;

    try {
        const response = await fetch("/api/admin-user-access", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${await auth.currentUser.getIdToken(true)}`
            },
            body: JSON.stringify({ uid: userDoc.id, disabled: disabling })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Could not update user access.");

        userAccessOverrides.set(userDoc.id, { accessDisabled: disabling });
        renderUserDirectory();
        await writeAuditEvent(
            disabling ? "User access suspended" : "User access reactivated",
            user.email || userDoc.id
        );
        showToast(disabling ? "User access suspended." : "User access reactivated.", "success");
    } catch (error) {
        showFirebaseError(error, "Could not update user access.");
    }
}

const userSearchInput = document.getElementById("user-search");
const userFilterSelect = document.getElementById("user-filter");
if (userSearchInput) userSearchInput.addEventListener("input", renderUserDirectory);
if (userFilterSelect) userFilterSelect.addEventListener("change", renderUserDirectory);
const articleSearchInput = document.getElementById("article-search");
const articleFilterSelect = document.getElementById("article-filter");
if (articleSearchInput) articleSearchInput.addEventListener("input", applyArticleFilters);
if (articleFilterSelect) articleFilterSelect.addEventListener("change", applyArticleFilters);
document.getElementById("load-more-articles")?.addEventListener("click", loadMoreArticles);
document.getElementById("refresh-articles")?.addEventListener("click", loadArticles);
document.getElementById("load-more-users")?.addEventListener("click", loadMoreUsers);
document.getElementById("load-more-messages")?.addEventListener("click", loadMoreMessages);
document.getElementById("load-more-audit")?.addEventListener("click", loadMoreAudit);
document.getElementById("refresh-users")?.addEventListener("click", loadUsers);
document.getElementById("refresh-messages")?.addEventListener("click", loadMessages);
document.getElementById("refresh-audit")?.addEventListener("click", loadAuditTrail);
document.getElementById("message-recipient-search")?.addEventListener("input", () => {
    clearTimeout(recipientLookupTimer);
    recipientLookupTimer = setTimeout(searchMessageRecipients, 250);
});

async function searchMessageRecipients() {
    const searchInput = document.getElementById("message-recipient-search");
    const recipientSelect = document.getElementById("message-recipient");
    if (!searchInput || !recipientSelect) return;

    const emailPrefix = searchInput.value.trim().toLowerCase();
    if (emailPrefix.length < 3) {
        recipientSelect.replaceChildren(new Option("Type at least 3 characters", ""));
        return;
    }

    recipientSelect.replaceChildren(new Option("Searching...", ""));
    try {
        const recipientQuery = query(
            collection(db, "users"),
            where("email", ">=", emailPrefix),
            where("email", "<=", `${emailPrefix}\uf8ff`),
            orderBy("email"),
            limit(25)
        );
        const snapshot = await getDocs(recipientQuery);
        if (searchInput.value.trim().toLowerCase() !== emailPrefix) return;
        const options = [new Option("Select a user", "")];
        snapshot.forEach((userDoc) => {
            const userData = userDoc.data();
            if (userData.email) {
                const option = new Option(
                    String(userData.displayName || userData.email),
                    userDoc.id
                );
                option.dataset.email = String(userData.email);
                options.push(option);
            }
        });
        if (options.length === 1) options.push(new Option("No matching users", ""));
        recipientSelect.replaceChildren(...options);
    } catch (error) {
        showFirebaseError(error, "Could not search for recipients.");
        recipientSelect.replaceChildren(new Option("Could not load users", ""));
    }
}

function formatActivityTime(timestamp) {
    const date = timestamp?.toDate instanceof Function ? timestamp.toDate() : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "Time unavailable";
}

function createActivityRow(titleText, detailText, timestamp) {
    const row = document.createElement("article");
    row.className = "activity-item";
    const title = document.createElement("strong");
    title.textContent = String(titleText || "Activity");
    const detail = document.createElement("p");
    detail.textContent = String(detailText || "");
    const time = document.createElement("small");
    time.textContent = formatActivityTime(timestamp);
    row.append(title, detail, time);
    return row;
}

function renderMessages() {
    const container = document.getElementById("message-log");
    if (!container) return;
    if (!messageDocuments.length) {
        setListState(container, "No messages have been sent.");
    } else {
        const rows = messageDocuments.map((messageDoc) => {
            const message = messageDoc.data();
            const recipient = message.recipientEmail || message.recipient || "Unknown recipient";
            const detail = `${recipient} - ${message.message || message.body || ""}`;
            return createActivityRow(message.subject || "Message", detail, message.createdAt || message.sentAt);
        });
        container.replaceChildren(...rows);
    }
    const button = document.getElementById("load-more-messages");
    if (button) button.hidden = !messageHasMore;
}

async function loadMoreMessages() {
    const container = document.getElementById("message-log");
    const button = document.getElementById("load-more-messages");
    if (!container || messageLoading || !messageHasMore) return;
    messageLoading = true;
    if (button) button.disabled = true;
    try {
        const constraints = [orderBy("createdAt", "desc")];
        if (messageCursor) constraints.push(startAfter(messageCursor));
        constraints.push(limit(PAGE_SIZE));
        const snapshot = await getDocs(query(collection(db, "messages"), ...constraints));
        messageDocuments.push(...snapshot.docs);
        messageCursor = snapshot.docs.at(-1) || messageCursor;
        messageHasMore = snapshot.size === PAGE_SIZE;
        renderMessages();
    } catch (error) {
        console.error("Message page loading error:", error);
        if (!messageDocuments.length) setListState(container, "Could not load messages.");
        showFirebaseError(error, "Could not load messages.");
    } finally {
        messageLoading = false;
        if (button) button.disabled = false;
    }
}

function loadMessages() {
    const container = document.getElementById("message-log");
    if (!container) return;
    messageDocuments = [];
    messageCursor = null;
    messageHasMore = true;
    setListState(container, "Loading messages...");
    loadMoreMessages();
}

function renderAuditTrail() {
    const auditContainer = document.getElementById("audit-list");
    const recentContainer = document.getElementById("recent-audit");
    const renderEvent = (eventDoc) => {
        const event = eventDoc.data();
        const title = event.action || event.type || event.event || "Admin activity";
        const detail = event.detail || event.message || event.description || event.actorEmail || event.target || "";
        return createActivityRow(title, detail, event.createdAt);
    };
    if (auditContainer) {
        if (auditDocuments.length) auditContainer.replaceChildren(...auditDocuments.map(renderEvent));
        else setListState(auditContainer, "No audit events recorded.");
    }
    if (recentContainer) {
        if (auditDocuments.length) recentContainer.replaceChildren(...auditDocuments.slice(0, 5).map(renderEvent));
        else setListState(recentContainer, "No recent activity.");
    }
    const button = document.getElementById("load-more-audit");
    if (button) button.hidden = !auditHasMore;
}

async function loadMoreAudit() {
    const container = document.getElementById("audit-list");
    const button = document.getElementById("load-more-audit");
    if (auditLoading || !auditHasMore) return;
    auditLoading = true;
    if (button) button.disabled = true;
    try {
        const constraints = [orderBy("createdAt", "desc")];
        if (auditCursor) constraints.push(startAfter(auditCursor));
        constraints.push(limit(PAGE_SIZE));
        const snapshot = await getDocs(query(collection(db, "audit_trail"), ...constraints));
        auditDocuments.push(...snapshot.docs);
        auditCursor = snapshot.docs.at(-1) || auditCursor;
        auditHasMore = snapshot.size === PAGE_SIZE;
        renderAuditTrail();
    } catch (error) {
        console.error("Audit page loading error:", error);
        if (container && !auditDocuments.length) setListState(container, "Could not load audit trail.");
        showFirebaseError(error, "Could not load audit trail.");
    } finally {
        auditLoading = false;
        if (button) button.disabled = false;
    }
}

function loadAuditTrail() {
    auditDocuments = [];
    auditCursor = null;
    auditHasMore = true;
    const auditContainer = document.getElementById("audit-list");
    const recentContainer = document.getElementById("recent-audit");
    if (auditContainer) setListState(auditContainer, "Loading audit trail...");
    if (recentContainer) setListState(recentContainer, "Loading activity...");
    if (!auditContainer && !recentContainer) return;
    loadMoreAudit();
}

async function loadSettings() {
    let settingsSnapshot;
    try {
        settingsSnapshot = await getDoc(doc(db, "settings", "site_config"));
    } catch (error) {
        loadedAdminViews.delete("settings");
        showFirebaseError(error, "Could not load site settings.");
        return;
    }
    if (!settingsSnapshot.exists()) return;

    const settings = settingsSnapshot.data();
    const valueFields = [
        ["setting-title", settings.siteTitle],
        ["setting-description", settings.siteDescription],
        ["setting-contact-email", settings.contactEmail],
        ["setting-subscription-price", settings.subscriptionPrice],
        ["setting-announcement", settings.announcement]
    ];
    for (const [id, value] of valueFields) {
        const input = document.getElementById(id);
        if (input && value !== undefined && value !== null) input.value = String(value);
    }

    const checkFields = [
        ["setting-feature-chat", settings.features?.aiChat],
        ["setting-feature-subscription", settings.features?.subscription],
        ["setting-feature-articles", settings.features?.articles],
        ["setting-contact-alerts", settings.contactAlerts],
        ["setting-signup-alerts", settings.signupAlerts]
    ];
    for (const [id, checked] of checkFields) {
        const input = document.getElementById(id);
        if (input && checked !== undefined) input.checked = checked === true;
    }
}
// ==========================================
// 1. NAVIGATION & MODAL CONTROLS
// ==========================================
const articleDialog = document.getElementById('article-dialog');
const navButtons = Array.from(document.querySelectorAll('.nav-item'));
const viewPanels = Array.from(document.querySelectorAll('.view-panel'));
let editingImageUrl = "";

function showView(targetView) {
    const activePanel = document.getElementById(`view-${targetView}`);
    if (!activePanel) return;

    for (const panel of viewPanels) panel.hidden = panel !== activePanel;
    for (const button of navButtons) {
        button.classList.toggle('active', button.dataset.view === targetView);
    }

    const viewTitle = document.getElementById('view-title');
    if (viewTitle) {
        const activeButton = navButtons.find((button) => button.dataset.view === targetView);
        viewTitle.textContent = activeButton?.textContent.trim() || targetView;
    }

    loadViewData(targetView);
}

for (const button of navButtons) {
    button.addEventListener('click', () => {
        if (button.dataset.view) showView(button.dataset.view);
    });
}

for (const button of document.querySelectorAll('[data-view-target]')) {
    button.addEventListener('click', () => {
        const targetView = button.dataset.viewTarget;
        if (targetView) showView(targetView);
    });
}

function loadViewData(view) {
    if (loadedAdminViews.has(view)) return;
    loadedAdminViews.add(view);

    if (view === 'articles') loadArticles();
    if (view === 'users') {
        loadUsers();
        loadSubscriptionRequests();
    }
    if (view === 'messages') loadMessages();
    if (view === 'audit') loadAuditTrail();
    if (view === 'settings') loadSettings();
}

for (const button of document.querySelectorAll('[data-open-editor]')) {
    button.addEventListener('click', () => openArticleEditor());
}

const closeEditorButton = document.getElementById('close-editor');
const cancelEditorButton = document.getElementById('cancel-editor');
if (closeEditorButton) closeEditorButton.addEventListener('click', () => articleDialog?.close());
if (cancelEditorButton) cancelEditorButton.addEventListener('click', () => articleDialog?.close());

function populateArticleEditor(articleId = "", article = {}) {
    const form = document.getElementById("article-form");
    const idInput = document.getElementById("article-id");
    const titleInput = document.getElementById("article-title");
    const categoryInput = document.getElementById("article-category");
    const tagsInput = document.getElementById("article-tags");
    const descriptionInput = document.getElementById("article-description");
    const contentInput = document.getElementById("article-content");
    const statusInput = document.getElementById("article-status");
    const imagePreview = document.getElementById("current-image");
    const dialogTitle = document.getElementById("article-dialog-title");
    if (!form || !idInput || !titleInput || !categoryInput || !tagsInput || !descriptionInput || !contentInput || !statusInput || !imagePreview) {
        showToast("Article editor is incomplete.", "error");
        return false;
    }

    form.reset();
    idInput.value = articleId;
    editingImageUrl = String(article.imageUrl || "");
    titleInput.value = String(article.title || "");
    categoryInput.value = String(article.category || "");
    tagsInput.value = String(article.tags || "");
    descriptionInput.value = String(article.description || "");
    contentInput.value = String(article.content || "");
    statusInput.value = article.status === "published" ? "published" : "draft";
    imagePreview.replaceChildren();
    imagePreview.hidden = true;

    if (article.imageUrl) {
        try {
            const imageUrl = new URL(article.imageUrl, window.location.href);
            if (["http:", "https:"].includes(imageUrl.protocol)) {
                const image = document.createElement("img");
                image.src = imageUrl.href;
                image.alt = "Current featured image";
                image.style.cssText = "display: block; max-width: 100%; max-height: 220px; object-fit: contain; margin: 10px 0;";
                imagePreview.appendChild(image);
                imagePreview.hidden = false;
            }
        } catch {
            showToast("The saved article image URL is invalid.", "error");
        }
    }

    if (dialogTitle) dialogTitle.textContent = articleId ? "Edit article" : "New article";
    return true;
}

function openArticleEditor() {
    if (!articleDialog || !populateArticleEditor()) return;
    articleDialog.showModal();
}

async function editArticle(articleId) {
    try {
        const articleSnapshot = await getDoc(doc(db, "articles", articleId));
        if (!articleSnapshot.exists()) {
            showToast("This article no longer exists.", "error");
            return;
        }
        if (!articleDialog || !populateArticleEditor(articleSnapshot.id, articleSnapshot.data())) return;
        articleDialog.showModal();
    } catch (error) {
        showFirebaseError(error, "Could not load this article.");
    }
}

window.editArticle = editArticle;

window.deleteArticle = async (articleId) => {
    if (!confirm("Delete this article permanently?")) return;
    try {
        await deleteDoc(doc(db, "articles", articleId));
        await writeAuditEvent("Article deleted", articleId);
        await refreshArticleCount();
        if (loadedAdminViews.has("articles")) loadArticles();
        showToast("Article deleted.", "success");
    } catch (error) {
        showFirebaseError(error, "Could not delete this article.");
    }
};


// ==========================================
// 2. SUBSCRIPTION ACTIVATION FORM
// ==========================================
const subscriptionForm = document.getElementById("subscription-form");

if (subscriptionForm) {
    subscriptionForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const emailInput = document.getElementById("subscription-email");
        const tidInput = document.getElementById("subscription-tid");
        const amountInput = document.getElementById("subscription-amount");
        const discountInput = document.getElementById("subscription-discount");
        const daysInput = document.getElementById("subscription-days");
        if (!emailInput || !tidInput || !amountInput || !discountInput || !daysInput) {
            showToast("Subscription form is incomplete.", "error");
            return;
        }

        const email = emailInput.value.trim().toLowerCase();
        const tid = sanitizeText(tidInput.value);
        const amount = Number(amountInput.value || 0);
        const discount = Number(discountInput.value || 0);
        const days = Number(daysInput.value || 30);

        if (!email || !isValidEmail(email)) {
            showToast("Please enter a valid email address.", "error");
            return;
        }

        if (!tid) {
            showToast("Please enter a transaction ID.", "error");
            return;
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            showToast("Please enter a valid subscription amount.", "error");
            return;
        }

        if (!Number.isFinite(discount) || discount < 0) {
            showToast("Please enter a valid discount amount.", "error");
            return;
        }

        if (!Number.isFinite(days) || days <= 0) {
            showToast("Please enter a valid number of days.", "error");
            return;
        }

        try {
            const q = query(collection(db, "users"), where("email", "==", email));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                showToast("No registered user found with Gmail: " + email, "error");
                return;
            }

            const userDoc = querySnapshot.docs[0];
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + days);

            await updateDoc(doc(db, "users", userDoc.id), {
                isPremium: true,
                subscription: "active",
                subscriptionEndsAt: expiryDate,
                subscriptionDays: days,
                jazzCashTid: tid,
                amountPaid: amount,
                discountAmount: discount,
                subscriptionUpdatedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                accessDisabled: false
            });
            await writeAuditEvent("Subscription activated", email);

            let requestCleanupFailed = false;
            if (currentSubscriptionRequestId) {
                try {
                    await deleteDoc(doc(db, "subscriptionRequests", currentSubscriptionRequestId));
                    currentSubscriptionRequestId = "";
                } catch (cleanupError) {
                    requestCleanupFailed = true;
                    showFirebaseError(cleanupError, "Subscription activated, but the request could not be removed.");
                }
            }

            subscriptionForm.reset();
            showToast(requestCleanupFailed
                ? `Subscription activated for ${email}, but its request remains pending.`
                : `Subscription activated for ${email}.`, requestCleanupFailed ? "warning" : "success");
        } catch (error) {
            showFirebaseError(error, "Could not activate the subscription.");
        }
    });
}


// ==========================================
// 3. ASSIGN TASK OR REWARD
// ==========================================
const taskForm = document.getElementById("task-form");
if (taskForm) {
    taskForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById("task-email");
        const messageInput = document.getElementById("task-message");
        const rewardInput = document.getElementById("task-reward");
        if (!emailInput || !messageInput || !rewardInput) {
            showToast("Task form is incomplete.", "error");
            return;
        }

        const email = emailInput.value;
        const normalizedEmail = email.trim().toLowerCase();
        const message = String(messageInput.value || "").trim();
        const reward = String(rewardInput.value || "").trim();
        if (!isValidEmail(normalizedEmail) || !message) {
            showToast("Enter a valid email and a task or reward message.", "error");
            return;
        }

        try {
            await addDoc(collection(db, "user_tasks"), {
                userEmail: normalizedEmail,
                taskMessage: message,
                rewardLabel: reward || "None",
                status: "pending",
                createdAt: serverTimestamp()
            });
            await writeAuditEvent("Task or reward assigned", normalizedEmail);

            showToast(`Task/reward assigned to ${normalizedEmail}.`, "success");
            taskForm.reset();
        } catch (error) {
            showFirebaseError(error, "Could not assign the task or reward.");
        }
    });
}


// ==========================================
// 4. DIRECT MESSAGING SYSTEM
// ==========================================
const messageForm = document.getElementById("message-form");
if (messageForm) {
    messageForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const recipientInput = document.getElementById("message-recipient");
        const subjectInput = document.getElementById("message-subject");
        const bodyInput = document.getElementById("message-body");
        if (!recipientInput || !subjectInput || !bodyInput) {
            showToast("Message form is incomplete.", "error");
            return;
        }

        const selectedOption = recipientInput.selectedOptions[0];
        const recipientId = sanitizeText(recipientInput.value);
        const to = sanitizeText(selectedOption?.dataset.email || "");
        const subject = sanitizeText(subjectInput.value);
        const message = String(bodyInput.value || "").trim();
        if (!to) {
            console.error("Cannot send message: selected recipient email (to) is missing.");
        }
        if (!subject) {
            console.error("Cannot send message: subject is missing.");
        }
        if (!message) {
            console.error("Cannot send message: message body is missing.");
        }
        if (!recipientId || !to || !subject || !message) {
            showToast("Choose a recipient and complete the subject and message.", "error");
            return;
        }

        const submitButton = messageForm.querySelector("button[type='submit']");
        let emailSent = false;
        try {
            const currentUser = auth.currentUser;
            if (!currentUser) {
                showToast("Sign in with an admin account before sending messages.", "error");
                return;
            }
            if (submitButton) submitButton.disabled = true;

            const idToken = await currentUser.getIdToken(true);
            const emailResponse = await fetch("/api/send-email", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: 'Bearer ' + idToken
                },
                body: JSON.stringify({ to, subject, message })
            });
            const emailResult = await emailResponse.json().catch(() => ({}));
            if (!emailResponse.ok) {
                const emailError = new Error(emailResult.error || "Email could not be delivered.");
                if (emailResponse.status === 401 || emailResponse.status === 403) {
                    emailError.code = "permission-denied";
                }
                throw emailError;
            }
            emailSent = true;

            await addDoc(collection(db, "messages"), {
                recipientId,
                recipientEmail: to,
                subject: subject,
                message,
                createdAt: serverTimestamp()
            });
            await writeAuditEvent("Message sent", to);

            showToast("Branded message sent successfully!", "success");
            messageForm.reset();
        } catch (error) {
            showFirebaseError(error, emailSent
                ? "Email was sent, but the message could not be logged in Firestore."
                : "Could not send the message.");
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });
}


// ==========================================
// 5. SITE CONFIGURATION & SETTINGS
// ==========================================
const settingsForm = document.getElementById("settings-form");
if (settingsForm) {
    settingsForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const titleInput = document.getElementById("setting-title");
        const descriptionInput = document.getElementById("setting-description");
        const contactEmailInput = document.getElementById("setting-contact-email");
        const subscriptionPriceInput = document.getElementById("setting-subscription-price");
        const announcementInput = document.getElementById("setting-announcement");
        const featureChatInput = document.getElementById("setting-feature-chat");
        const featureSubscriptionInput = document.getElementById("setting-feature-subscription");
        const featureArticlesInput = document.getElementById("setting-feature-articles");
        const contactAlertsInput = document.getElementById("setting-contact-alerts");
        const signupAlertsInput = document.getElementById("setting-signup-alerts");
        if (!titleInput || !descriptionInput || !contactEmailInput || !subscriptionPriceInput || !announcementInput || !featureChatInput || !featureSubscriptionInput || !featureArticlesInput || !contactAlertsInput || !signupAlertsInput) {
            showToast("Settings form is incomplete.", "error");
            return;
        }

        const siteTitle = sanitizeText(titleInput.value);
        const siteDesc = String(descriptionInput.value || "").trim();
        const contactEmail = contactEmailInput.value.trim().toLowerCase();
        const subPrice = parseFloat(subscriptionPriceInput.value || 0);
        const announcement = String(announcementInput.value || "").trim();
        if (!siteTitle || (contactEmail && !isValidEmail(contactEmail)) || !Number.isFinite(subPrice) || subPrice < 0) {
            showToast("Check the site title, contact email, and subscription price.", "error");
            return;
        }

        const featureChat = featureChatInput.checked;
        const featureSub = featureSubscriptionInput.checked;
        const featureArticles = featureArticlesInput.checked;

        try {
            await setDoc(doc(db, "settings", "site_config"), {
                siteTitle,
                siteDescription: siteDesc,
                contactEmail,
                subscriptionPrice: subPrice,
                announcement,
                contactAlerts: contactAlertsInput.checked,
                signupAlerts: signupAlertsInput.checked,
                features: {
                    aiChat: featureChat,
                    subscription: featureSub,
                    articles: featureArticles
                },
                updatedAt: serverTimestamp()
            }, { merge: true });
            await writeAuditEvent("Site settings updated", siteTitle);

            showToast("Site settings saved successfully!", "success");
        } catch (error) {
            showFirebaseError(error, "Could not save site settings.");
        }
    });
}


// ==========================================
// 6. REAL-TIME DATA LISTENERS (COUNTERS & LOGS)
// ==========================================
async function refreshArticleCount() {
    try {
        const snapshot = await getCountFromServer(collection(db, "articles"));
        const articleCount = document.getElementById("stat-articles");
        if (articleCount) articleCount.textContent = String(snapshot.data().count);
    } catch (error) {
        showFirebaseError(error, "Could not load article totals.");
    }
}

function loadDashboardListeners() {
    const setCount = async (countQuery, elementId, fallback) => {
        try {
            const snapshot = await getCountFromServer(countQuery);
            const element = document.getElementById(elementId);
            if (element) element.textContent = String(snapshot.data().count);
        } catch (error) {
            showFirebaseError(error, fallback);
        }
    };

    refreshArticleCount();
    setCount(collection(db, "users"), "stat-users", "Could not load user totals.");
    setCount(collection(db, "siteVisits"), "stat-visits", "Could not load site-visit totals.");

    const activePresenceQuery = query(
        collection(db, "presence"),
        where("lastSeen", ">=", Timestamp.fromMillis(Date.now() - 5 * 60 * 1000)),
        orderBy("lastSeen", "desc"),
        limit(500)
    );
    const presenceUnsubscribe = onSnapshot(activePresenceQuery, (snapshot) => {
        userPresence = new Map(snapshot.docs.map((presenceDoc) => [presenceDoc.id, presenceDoc.data()]));
        const activeUsers = document.getElementById("stat-active-users");
        if (activeUsers) activeUsers.textContent = String(snapshot.size);
        renderUserDirectory();
    }, (error) => showFirebaseError(error, "Could not load active-user presence."));
    registerListener(presenceUnsubscribe);

}
