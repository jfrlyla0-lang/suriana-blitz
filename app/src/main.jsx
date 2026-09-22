import { ChatView } from './Chat.jsx';
import React, { useEffect, useState } from 'react';

const loadGoogleIdentityScript = () => new Promise((resolve, reject) => {
  if (window.google?.accounts?.id) {
    resolve();
    return;
  }

  const oldScript = document.querySelector(
    'script[src="https://accounts.google.com/gsi/client"]'
  );

  if (oldScript) {
    oldScript.addEventListener('load', resolve, { once: true });
    oldScript.addEventListener('error', reject, { once: true });
    return;
  }

  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  script.onload = resolve;
  script.onerror = reject;
  document.head.appendChild(script);
});


import { AdminDashboardMissions } from './AdminDashboardMissions.jsx';
import { createRoot } from 'react-dom/client';
import './index.css';

const API_BASE = "";

async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  const data = await response.json().catch(() => ({
    success: false,
    message: 'استجابة غير صالحة من السيرفر',
  }));

  if (!response.ok) {
    throw new Error(data.message || 'حدث خطأ في الاتصال بالسيرفر');
  }

  return data;
}

function ChargeForm({ points, amountSyr, gateways, onCancel, onAddLog }) {
  const [method, setMethod] = useState('sham');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const submitCharge = async () => {
    if(loading) return;

    if(!fullName.trim()){
      return alert("يرجى إدخال الاسم الثلاثي");
    }

    if(!phone.trim()){
      return alert("يرجى إدخال رقم هاتف المحوّل");
    }

    if(!receiptFile){
      return alert("🚨 صورة إيصال الدفع إلزامية");
    }

    if(!receiptFile.type.startsWith("image/")){
      return alert("الملف يجب أن يكون صورة");
    }

    if(receiptFile.size > 8 * 1024 * 1024){
      return alert("حجم صورة الإيصال يجب ألا يتجاوز 8MB");
    }

    if(!window.confirm(
      `تأكيد إرسال طلب شحن ${Number(points).toLocaleString("ar-SY")} نقطة؟\n\n` +
      `سيتم إرسال الإيصال للإدارة للمراجعة.`
    )){
      return;
    }

    setLoading(true);

    try{
  

      const receipt = await new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("تعذر قراءة صورة الإيصال"));

        reader.readAsDataURL(receiptFile);
      });

      const res = await fetch(`${window.location.origin}/api/wallet/charge`, {
        method:"POST",
        headers:{
          "Content-Type":"application/json"
        },
        credentials:"include",
        body:JSON.stringify({
          points:Number(points),
          amount_syr:
            Number(points) === 500
              ? 50000
              : Number(points) === 1200
              ? 100000
              : Number(points) === 3000
              ? 250000
              : 0,
          method,
          phone:phone.trim(),
          receipt
        })
      });

      const data = await res.json();

      if(!res.ok || !data.success){
        alert(data.message || "تعذر إرسال طلب الشحن");
        return;
      }

      if(onAddLog){
        onAddLog({
          type:"شحن",
          desc:`طلب شحن ${Number(points).toLocaleString("ar-SY")} نقطة (${method === "sham" ? "شام كاش" : "سيريتل / MTN"})`,
          status:"⏳ قيد مراجعة الإدارة"
        });
      }

      alert(
        `⏳ تم إرسال طلب الشحن بنجاح!\n\n` +
        `💳 النقاط: ${Number(points).toLocaleString("ar-SY")}\n` +
        `🧾 تم حفظ الإيصال للمراجعة الإدارية.`
      );

      onCancel();

    }catch(err){
      console.error("CHARGE UI ERROR:",err);
      alert("حدث خطأ أثناء إرسال طلب الشحن");
    }finally{
      setLoading(false);
    }
  };

  return (
    <div
      className="auth-container"
      style={{
        background:'rgba(26,21,37,0.95)',
        padding:'24px',
        borderRadius:'24px',
        border:'1px solid #3b82f6',
        marginTop:'12px',
        textAlign:'right'
      }}
    >
      <h3
        style={{
          color:'#60a5fa',
          margin:'0 0 16px 0',
          textAlign:'center'
        }}
      >
        💳 إتمام الشحن اليدوي
      </h3>

      <p
        style={{
          fontSize:'13px',
          color:'#9ca3af',
          textAlign:'center'
        }}
      >
        شحن {Number(points).toLocaleString("ar-SY")} نقطة ثمنها {amountSyr} ل.س
      </p>

      <div
        style={{
          display:'flex',
          gap:'8px',
          marginBottom:'12px'
        }}
      >
        <button
          type="button"
          disabled={loading}
          style={{
            flex:1,
            height:'36px',
            borderRadius:'10px',
            background:method==='sham'
              ? '#3b82f6'
              : 'rgba(255,255,255,0.04)',
            color:'#fff',
            border:'none'
          }}
          onClick={()=>setMethod('sham')}
        >
          شام كاش
        </button>

        <button
          type="button"
          disabled={loading}
          style={{
            flex:1,
            height:'36px',
            borderRadius:'10px',
            background:method==='syriatel'
              ? '#3b82f6'
              : 'rgba(255,255,255,0.04)',
            color:'#fff',
            border:'none'
          }}
          onClick={()=>setMethod('syriatel')}
        >
          سيريتل / MTN
        </button>
      </div>

      <div
        style={{
          background:'#000',
          padding:'10px',
          borderRadius:'10px',
          textAlign:'center',
          color:'#10b981',
          fontWeight:'bold',
          marginBottom:'12px',
          fontSize:'12px'
        }}
      >
        {method === 'sham'
          ? "رقم محفظة شام كاش: " + gateways.sham
          : "رقم تحويل سيريتل: " + gateways.syriatel
        }
      </div>

      <input
        type="text"
        placeholder="الاسم الثلاثي (إجباري)"
        className="input-custom"
        value={fullName}
        onChange={e=>setFullName(e.target.value)}
        disabled={loading}
        style={{marginBottom:'12px'}}
      />

      <input
        type="text"
        placeholder="رقم هاتف المحوّل"
        className="input-custom"
        value={phone}
        onChange={e=>setPhone(e.target.value)}
        disabled={loading}
        style={{marginBottom:'12px'}}
      />

      <label
        style={{
          display:'block',
          background:"rgba(255,255,255,0.03)",
          padding:"12px",
          borderRadius:"14px",
          border:"1px solid rgba(255,255,255,0.08)",
          marginBottom:"12px",
          cursor:loading ? "not-allowed" : "pointer"
        }}
      >
        <div
          style={{
            color:"#fff",
            fontSize:"13px",
            marginBottom:"8px"
          }}
        >
          🧾 إرفاق صورة إيصال الدفع
        </div>

        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={loading}
          onChange={e=>setReceiptFile(e.target.files?.[0] || null)}
          style={{
            width:"100%",
            color:"#9ca3af",
            fontSize:"12px"
          }}
        />

        {receiptFile && (
          <div
            style={{
              marginTop:"8px",
              color:"#86efac",
              fontSize:"12px"
            }}
          >
            ✅ {receiptFile.name}
          </div>
        )}
      </label>

      <div
        style={{
          background:"rgba(59,130,246,0.08)",
          border:"1px solid rgba(59,130,246,0.2)",
          color:"#93c5fd",
          padding:"10px",
          borderRadius:"12px",
          fontSize:"12px",
          lineHeight:"1.6",
          marginBottom:"14px"
        }}
      >
        🔐 الإيصال يُحفظ على السيرفر ويرتبط بطلب الشحن.
        <br/>
        لن تُضاف النقاط إلا بعد موافقة الإدارة.
      </div>

      <div
        style={{
          display:'flex',
          gap:'10px',
          marginTop:'16px'
        }}
      >
        <button
          type="button"
          className="btn-primary-custom"
          disabled={loading}
          style={{
            flex:1,
            opacity:loading ? 0.6 : 1
          }}
          onClick={submitCharge}
        >
          {loading ? "⏳ جاري الإرسال..." : "💳 إرسال طلب الشحن"}
        </button>

        <button
          type="button"
          className="btn-primary-custom"
          disabled={loading}
          style={{
            flex:1,
            background:'rgba(255,255,255,0.05)'
          }}
          onClick={onCancel}
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}

function WithdrawForm({ onCancel, onAddLog, userPoints, setUserPoints }) {
  const [withdrawPoints, setWithdrawPoints] = useState(5000);
  const [method, setMethod] = useState('sham');
  const [walletNum, setWalletNum] = useState('');
  const [notes, setNotes] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);

  const withdrawOptions = [
    { p:5000, syr:'٥٠,٠٠٠' },
    { p:15000, syr:'١٨٠,٠٠٠' },
    { p:30000, syr:'٤٠٠,٠٠٠' },
    { p:50000, syr:'٧٠٠,٠٠٠' }
  ];

  const availablePoints = Number(userPoints || 0);

  const submitWithdraw = async () => {
    if(loading) return;

    if(!fullName.trim()){
      return alert("يرجى إدخال الاسم الثلاثي");
    }

    if(!walletNum.trim()){
      return alert("يرجى إدخال رقم أو كود المحفظة");
    }

    if(availablePoints < withdrawPoints){
      return alert(
        `الرصيد المتاح غير كافي.\nتحتاج ${withdrawPoints.toLocaleString("ar-SY")} نقطة.`
      );
    }

    if(!window.confirm(
      `تأكيد طلب سحب ${withdrawPoints.toLocaleString("ar-SY")} نقطة؟\n\n` +
      `بعد التأكيد سيتم حجز النقاط حتى تتم مراجعة الطلب.`
    )){
      return;
    }

    setLoading(true);

    try{
  

      const res = await fetch(`${window.location.origin}/api/wallet/withdraw`, {
        method:"POST",
        headers:{
          "Content-Type":"application/json"
        },
        credentials:"include",
        body:JSON.stringify({
          points:withdrawPoints,
          method,
          wallet_num:walletNum.trim(),
          notes:`${fullName.trim()}${notes.trim() ? " — " + notes.trim() : ""}`
        })
      });

      const data = await res.json();

      if(!data.success){
        alert(data.message || "تعذر إرسال طلب السحب");
        return;
      }

      if(typeof data.available_points === "number" && setUserPoints){
        setUserPoints(data.available_points);
      }else if(setUserPoints){
        setUserPoints(prev => Math.max(0, Number(prev || 0) - withdrawPoints));
      }

      if(onAddLog){
        onAddLog({
          type:"سحب أرباح",
          desc:`حجز ${withdrawPoints.toLocaleString("ar-SY")} نقطة (${method === "sham" ? "شام كاش" : "سيريتل / MTN"})`,
          status:"🔒 محجوز — قيد المراجعة"
        });
      }

      alert(
        `💸 تم إرسال طلب السحب بنجاح!\n\n` +
        `🔒 تم حجز ${withdrawPoints.toLocaleString("ar-SY")} نقطة.\n` +
        `⏳ الطلب الآن قيد مراجعة الإدارة.`
      );

      onCancel();

    }catch(err){
      console.error("WITHDRAW UI ERROR:", err);
      alert("حدث خطأ أثناء الاتصال بالسيرفر");
    }finally{
      setLoading(false);
    }
  };

  return (
    <div
      className="auth-container"
      style={{
        background:'rgba(26,21,37,0.95)',
        padding:'24px',
        borderRadius:'24px',
        border:'1px solid #ff6b8b',
        marginTop:'12px',
        textAlign:'right'
      }}
    >
      <h3
        style={{
          color:'#ff6b8b',
          margin:'0 0 16px 0',
          textAlign:'center'
        }}
      >
        📥 طلب سحب الكاش
      </h3>

      <div
        style={{
          background:'rgba(255,107,139,0.08)',
          border:'1px solid rgba(255,107,139,0.25)',
          borderRadius:'16px',
          padding:'12px',
          marginBottom:'14px',
          textAlign:'center'
        }}
      >
        <div style={{fontSize:'12px',color:'#9ca3af'}}>
          رصيدك المتاح حالياً
        </div>

        <strong style={{fontSize:'24px',color:'#fff'}}>
          {availablePoints.toLocaleString("ar-SY")} نقطة
        </strong>

        <div style={{fontSize:'11px',color:'#fbbf24',marginTop:'5px'}}>
          🔒 النقاط المطلوبة سيتم حجزها عند تأكيد الطلب
        </div>
      </div>

      <select
        className="input-custom"
        value={withdrawPoints}
        onChange={e=>setWithdrawPoints(Number(e.target.value))}
        style={{
          color:'#fff',
          marginBottom:'12px',
          background:'#110a1c'
        }}
        disabled={loading}
      >
        {withdrawOptions.map(o=>(
          <option key={o.p} value={o.p}>
            {o.p.toLocaleString("ar-SY")} نقطة = {o.syr} ل.س
          </option>
        ))}
      </select>

      <div
        style={{
          background:'rgba(255,255,255,0.04)',
          borderRadius:'12px',
          padding:'10px 12px',
          marginBottom:'12px',
          fontSize:'12px',
          color: availablePoints >= withdrawPoints ? '#86efac' : '#fca5a5'
        }}
      >
        {availablePoints >= withdrawPoints
          ? `✅ يمكنك طلب هذا السحب — سيبقى ${ (availablePoints - withdrawPoints).toLocaleString("ar-SY") } نقطة متاحة`
          : `❌ تحتاج ${(withdrawPoints - availablePoints).toLocaleString("ar-SY")} نقطة إضافية`
        }
      </div>

      <input
        type="text"
        placeholder="الاسم الثلاثي (إجباري)"
        className="input-custom"
        value={fullName}
        onChange={e=>setFullName(e.target.value)}
        disabled={loading}
        style={{marginBottom:'12px'}}
      />

      <div style={{display:'flex',gap:'8px',marginBottom:'12px'}}>
        <button
          type="button"
          disabled={loading}
          style={{
            flex:1,
            height:'40px',
            borderRadius:'10px',
            background:method==='sham'
              ? '#ff6b8b'
              : 'rgba(255,255,255,0.04)',
            color:'#fff',
            border:'1px solid #ff6b8b'
          }}
          onClick={()=>setMethod('sham')}
        >
          شام كاش
        </button>

        <button
          type="button"
          disabled={loading}
          style={{
            flex:1,
            height:'40px',
            borderRadius:'10px',
            background:method==='syriatel'
              ? '#ff6b8b'
              : 'rgba(255,255,255,0.04)',
            color:'#fff',
            border:'1px solid #ff6b8b'
          }}
          onClick={()=>setMethod('syriatel')}
        >
          سيريتل / MTN
        </button>
      </div>

      <input
        type="text"
        placeholder={
          method==='sham'
            ? "رابط أو رقم محفظة شام كاش"
            : "كود أو رقم تحويل سيريتل / MTN"
        }
        className="input-custom"
        value={walletNum}
        onChange={e=>setWalletNum(e.target.value)}
        disabled={loading}
        style={{marginBottom:'12px'}}
      />

      <input
        type="text"
        placeholder="ملاحظات للمدير (اختياري)"
        className="input-custom"
        value={notes}
        onChange={e=>setNotes(e.target.value)}
        disabled={loading}
        style={{marginBottom:'12px'}}
      />

      <div
        style={{
          background:'rgba(251,191,36,0.08)',
          border:'1px solid rgba(251,191,36,0.2)',
          color:'#fbbf24',
          padding:'11px',
          borderRadius:'12px',
          fontSize:'12px',
          lineHeight:'1.6',
          marginBottom:'14px'
        }}
      >
        🔒 عند تأكيد الطلب سيتم حجز النقاط المطلوبة فوراً.
        <br/>
        إذا وافقت الإدارة يبقى الحجز مثبتاً، وإذا رُفض الطلب تُعاد النقاط لرصيدك.
      </div>

      <div style={{display:'flex',gap:'10px',marginTop:'16px'}}>
        <button
          type="button"
          className="btn-primary-custom"
          disabled={loading || availablePoints < withdrawPoints}
          style={{
            flex:1,
            background:
              loading || availablePoints < withdrawPoints
                ? 'rgba(255,255,255,0.08)'
                : 'linear-gradient(45deg, #ff6b8b, #ec4899)',
            opacity:
              loading || availablePoints < withdrawPoints
                ? 0.6
                : 1
          }}
          onClick={submitWithdraw}
        >
          {loading ? "⏳ جاري إرسال الطلب..." : "💸 تأكيد السحب"}
        </button>

        <button
          type="button"
          disabled={loading}
          className="btn-primary-custom"
          style={{
            flex:1,
            background:'rgba(255,255,255,0.05)'
          }}
          onClick={onCancel}
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("login");
  const [tab, setTab] = useState("discover");
  const [searchUsers, setSearchUsers] = useState([]);
    const [selectedChatUser, setSelectedChatUser] = useState(null);
  const [discoverIndex, setDiscoverIndex] = useState(0);
  const [discoverLiked, setDiscoverLiked] = useState(false);
  const [discoverLikeLoading, setDiscoverLikeLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);
  const [userPoints, setUserPoints] = useState(0);
  const [wealth, setWealth] = useState(0);
  const [wealthLevel, setWealthLevel] = useState(0);
  const [attraction, setAttraction] = useState(0);
  const [attractionLevel, setAttractionLevel] = useState(0);
  const [likesCount, setLikesCount] = useState(0);
const [editingProfileName, setEditingProfileName] = useState(false);
const [profileNameInput, setProfileNameInput] = useState("");
const [profileNameSaving, setProfileNameSaving] = useState(false);

const saveProfileName = async () => {
  const name = String(profileNameInput || "").trim();

  if(name.length < 2 || name.length > 40){
    alert("الاسم يجب أن يكون بين حرفين و40 حرفاً");
    return;
  }

  setProfileNameSaving(true);

  try {
    const data = await apiRequest("/api/profile/name", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name })
    });

    if(data.success){
      setUser(prev => ({
        ...prev,
        name: data.name || name
      }));
      setEditingProfileName(false);
    } else {
      alert(data.message || "تعذر تحديث الاسم");
    }
  } catch(err) {
    console.log("PROFILE NAME SAVE ERROR:", err);
    alert("حدث خطأ أثناء تحديث الاسم");
  } finally {
    setProfileNameSaving(false);
  }
};


  const [profileAvatarSaving, setProfileAvatarSaving] = useState(false);

  const saveProfileAvatar = async (file) => {
    if (!file || profileAvatarSaving) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      alert("الصورة يجب أن تكون JPG أو PNG أو WebP");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      alert("حجم صورة البروفايل يجب ألا يتجاوز 8MB");
      return;
    }

    setProfileAvatarSaving(true);

    try {
      const avatar = await new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("تعذر قراءة الصورة"));

        reader.readAsDataURL(file);
      });

      const data = await apiRequest("/api/profile/avatar", {
        method: "PUT",
        body: JSON.stringify({ avatar })
      });

      if (data.success) {
        setUser(prev => ({
          ...prev,
          avatar: data.avatar || null
        }));

        alert("تم تحديث صورة البروفايل ✅");
      } else {
        alert(data.message || "تعذر تحديث صورة البروفايل");
      }
    } catch (err) {
      console.log("PROFILE AVATAR SAVE ERROR:", err);
      alert(err.message || "حدث خطأ أثناء تحديث صورة البروفايل");
    } finally {
      setProfileAvatarSaving(false);
    }
  };

  const loadWalletStats = async () => {
    try {
      const data = await apiRequest("/api/wallet");
      if(data.success && data.wallet){
        setUserPoints(Number(data.wallet.points || 0));
        setWealth(Number(data.wallet.wealth || 0));
        setWealthLevel(Number(data.wallet.wealthLevel || 0));
        setAttraction(Number(data.wallet.attraction || 0));
        setAttractionLevel(Number(data.wallet.attractionLevel || 0));
      setWalletLogs(data.wallet.logs || []);
      }
    } catch(err) {
      console.log("WALLET STATS ERROR:", err);
    }
  };
  const [isAdmin, setIsAdmin] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState("none");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [adminSubTab, setAdminSubTab] = useState("users");
  const [adminPass, setAdminPass] = useState("");
    const [activeCharge, setActiveCharge] = useState(null);

  const [sessionChecking, setSessionChecking] = useState(true);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceAnnouncement, setMaintenanceAnnouncement] = useState("");
  const [walletLogs, setWalletLogs] = useState([]);
const [viewedProfile, setViewedProfile] = useState(null);
  const [paymentGateways, setPaymentGateways] = useState({sham_cash:"",syriatel_cash:"",mtn_cash:""});

useEffect(() => {
  const handleOpenUserProfile = (event) => {
    const profile = event.detail;

    
    if (!profile || !profile.id) {
      return;
    }

    setViewedProfile(profile);
  };

  window.addEventListener(
    "suriana:open-user-profile",
    handleOpenUserProfile
  );

  return () => {
    window.removeEventListener(
      "suriana:open-user-profile",
      handleOpenUserProfile
    );
  };
}, []);

  useEffect(() => {
    const loadPaymentGateways = async () => {
      try {
        const response = await fetch("/api/payment-settings");
        const data = await response.json();
        if (data.success && data.settings) {
          setPaymentGateways({
            sham_cash: data.settings.sham_cash || "",
            syriatel_cash: data.settings.syriatel_cash || "",
            mtn_cash: data.settings.mtn_cash || ""
          });
        }
      } catch (err) {
        console.log("PAYMENT GATEWAYS ERROR:", err);
      }
    };

    loadPaymentGateways();
  }, []);

  useEffect(() => {
    const loadAppStatus = async () => {
      try {
        const response = await fetch("/api/app-status");
        const data = await response.json();

        if (data.success) {
          setMaintenanceMode(Number(data.maintenance) === 1);
          setMaintenanceAnnouncement(data.announcement || "");
        }
      } catch (err) {
        console.log("APP STATUS ERROR:", err);
      }
    };

    loadAppStatus();

    const timer = setInterval(loadAppStatus, 15000);
    return () => clearInterval(timer);
  }, []);
  const addWalletLog = () => {
    loadWalletStats();
  };
  

const loadUsers = async (q="")=>{
  try{
    setUsersLoading(true);

    const r = await fetch(
      `${window.location.origin}/api/users/search?q=${encodeURIComponent(q)}`,
      {
        credentials:"include"
      }
    );

    const data = await r.json();
    if(data.success){
      setSearchUsers(data.users);
    }
  }catch(e){
    console.error(e);
  }finally{
    setUsersLoading(false);
  }
};

  const [form, setForm] = useState({name:"",email:"",password:"",birth_date:"",city:"",gender:"",phone:"",referral_code:""});
  const [googleCredential, setGoogleCredential] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthYear, setBirthYear] = useState("");

  const updateBirthDate = (day, month, year) => {
    setBirthDay(day);
    setBirthMonth(month);
    setBirthYear(year);
    setForm(prev => ({
      ...prev,
      birth_date: (year && month && day) ? `${year}-${month}-${day}` : ""
    }));
  };
  const handleLogout = async () => {
  try {
    await fetch(`${API_BASE}/api/logout`, {
      method: "POST",
      credentials: "include"
    });
  } catch (err) {
    console.error("LOGOUT ERROR:", err);
  }

  setUser(null);
  setUserPoints(0);
  setIsVerified(false);
  setIsAdmin(false);
  setPage("login");
};

const markNotificationsAsRead = async () => {
  const unread = notifications.filter(n => Number(n.is_read) === 0);
  if (unread.length === 0) return;

  try {
    await Promise.all(
      unread.map(n =>
        fetch(`${API_BASE}/api/notifications/read/${n.id}`, {
          method: "POST",
          credentials: "include"
        })
      )
    );

    setNotifications(prev =>
      prev.map(n => ({ ...n, is_read: 1 }))
    );
  } catch (error) {
    console.error("NOTIFICATIONS READ ERROR:", error);
  }
};

const loadNotifications = async () => {
  try {
    const response = await fetch(`${API_BASE}/api/notifications`, {
      credentials: "include"
    });

    const data = await response.json();
    if (data.success) {
      setNotifications(data.notifications || []);
    }
  } catch (error) {
    console.error("NOTIFICATIONS LOAD ERROR:", error);
  }
};

useEffect(() => {
  loadNotifications();

  const timer = setInterval(loadNotifications, 10000);
  return () => clearInterval(timer);
}, []);

useEffect(() => {
  if (user) {
    loadNotifications();
  }
}, [user]);

  const loadProfileLikesCount = async () => {
    try {
      const data = await apiRequest("/api/profile-likes/" + Number(user?.id) + "/count");
      if(data.success){
        setLikesCount(Number(data.likes || 0));
      }
    } catch(err) {
      console.log("PROFILE LIKES COUNT ERROR:", err);
    }
  };

  useEffect(() => {
    if(user){
      loadWalletStats();
      loadProfileLikesCount();
    }
  }, [user]);

  useEffect(() => {
    const restoreSession = async () => {

      if (!token) {
        setSessionChecking(false);
        return;
      }

      try {
        const data = await apiRequest("/api/me");

        if (data.success && data.user) {
          setUser(data.user);
            setForm(data.user);
          setUserPoints(Number(data.user.points || 0));
          setIsVerified(Boolean(data.user.is_verified));

fetch(`${window.location.origin}/api/verification/status`,{
})
.then(r=>r.json())
.then(v=>{
 if(v.success){
  setVerificationStatus(v.status);
  setIsVerified(v.status==="approved");
 }
});
            if(data.role === "owner" || data.role === "admin" || data.user.role === "admin" || data.user.role === "owner"){
              setIsAdmin(true);
              setPage("app");
              setTab("admin_panel");
            }else{
              setPage("app");
              setTab("discover");
            }
        } else {
          
        }
      } catch (err) {
        
      } finally {
        setSessionChecking(false);
      }
    };

    restoreSession();
  }, []);

  
  const handleGoogleLogin = async () => {
    try {
      setAuthError("");
      setAuthLoading(true);

      await loadGoogleIdentityScript();

      window.google.accounts.id.initialize({
        client_id: "569303644021-pq09evs992200m4vt65i3c883c69fdfa.apps.googleusercontent.com",
        callback: async (response) => {
          try {
            if (!response?.credential) {
              throw new Error("لم يتم استلام بيانات Google");
            }

            const data = await apiRequest("/api/auth/google", {
              method: "POST",
              body: JSON.stringify({
                credential: response.credential
              })
            });

            if (!data.success) {
              throw new Error(data.message || "فشل تسجيل الدخول بواسطة Google");
            }

            if (data.existing && data.success && data.user) {
              setUser(data.user);
              setUserPoints(Number(data.user.points || 0));
              setIsVerified(Boolean(data.user.is_verified));
              setIsAdmin(data.user.role === "admin" || data.user.role === "owner");
              setPage("app");
              setTab("discover");
              return;
            }

            if (!data.existing && data.google) {
      setGoogleCredential(response.credential);
              setForm(prev => ({
                ...prev,
                name: data.google.name || "",
                email: data.google.email || ""
              }));
              setPage("register");
              return;
            }

            throw new Error("استجابة Google غير مكتملة");
          } catch (err) {
            setAuthError(err.message || "تعذر تسجيل الدخول بواسطة Google");

          } finally {
            setAuthLoading(false);
          }
        }
      });

      window.google.accounts.id.prompt();

    } catch (err) {
      setAuthLoading(false);
      setAuthError(err.message || "تعذر تشغيل Google");
      alert("GOOGLE START ERROR: " + (err.message || "Unknown error"));
    }
  };

const handleLogin = async (e) => {
    e?.preventDefault();
    setAuthError("");
    try {
      setAuthLoading(true);
      const data = await apiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          password: form.password
        })
      });
      if (!data.success || (data.role !== "admin" && !data.user)) {
        throw new Error(data.message || "فشل تسجيل الدخول");
      }
      if (data.role === "admin") {
        setIsAdmin(true);
          setPage("app");
        setTab("admin_panel");
        return;
      }

      setUser(data.user);
      setUserPoints(Number(data.user.points || 0));
      setIsVerified(Boolean(data.user.is_verified));

      const ADMIN_EMAILS = [
  "jfrlyla0@gmail.com",
  ""
];

if (ADMIN_EMAILS.includes(data.user?.email)) {
        setIsAdmin(true);
        setTab("admin_panel");
        setPage("app");
      } else {
        setIsAdmin(false);
        setPage("app");
        setTab("discover");
      }
    } catch (err) {
      setAuthError(err.message || "تعذر تسجيل الدخول");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    if (!form.gender) {
      alert("يرجى اختيار الجنس");
      return;
    }
    e?.preventDefault();
    setAuthError("");
    try {
      setAuthLoading(true);
      const registerEndpoint = googleCredential
      ? "/api/auth/google/register"
      : "/api/register";

    const registerBody = googleCredential
      ? {
          credential: googleCredential,
          name: form.name,
          birth_date: form.birth_date,
          city: form.city,
          gender: form.gender
        }
      : {
          name: form.name,
          email: form.email,
          password: form.password,
          birth_date: form.birth_date,
          city: form.city,
          gender: form.gender
        };

    const data = await apiRequest(registerEndpoint, {
      method: "POST",
      body: JSON.stringify(registerBody)
    });

      if (!data.success || (data.role !== "admin" && !data.user)) {
        throw new Error(data.message || "فشل إنشاء الحساب");
      }

      setUser(data.user);
      setUserPoints(Number(data.user.points || 0));
      setIsVerified(Boolean(data.user.is_verified));
      setPage("app");
      setTab("discover");
    } catch (err) {
      setAuthError(err.message || "تعذر إنشاء الحساب");
    } finally {
      setAuthLoading(false);
    }
  };





  const discoverUsers = searchUsers.filter(
    u => Number(u.id) !== Number(user?.id)
  );

  const currentPerson = discoverUsers.length
    ? discoverUsers[Math.min(discoverIndex, discoverUsers.length - 1)]
    : null;

    const discoverImage = currentPerson?.avatar
      ? (
          String(currentPerson.avatar || "").startsWith("data:")
            ? currentPerson.avatar
            : String(currentPerson.avatar || "").startsWith("http")
              ? currentPerson.avatar
              : `${window.location.origin}/` +
                String(currentPerson.avatar || "").replace(/^\//, "")
        )
      : "https://images.unsplash.com/photo-1494790108377-be9c29b29330";

  useEffect(() => {
    if (tab === "discover") {
      setDiscoverIndex(0);
      loadUsers("");
    }
  }, [tab, user?.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadDiscoverLike() {
      if (!currentPerson?.id) {
        setDiscoverLiked(false);
        return;
      }

      try {
        const data = await apiRequest(
          "/api/profile-likes/" + Number(currentPerson.id)
        );

        if (!cancelled) {
          setDiscoverLiked(Boolean(data.success && data.liked));
        }
      } catch(err) {
        if (!cancelled) {
          setDiscoverLiked(false);
        }
      }
    }

    loadDiscoverLike();

    return () => {
      cancelled = true;
    };
  }, [currentPerson?.id]);
  if (maintenanceMode && user && !isAdmin) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#0e0816', color: '#fff', direction: 'rtl', fontFamily: 'sans-serif', padding: '20px', boxSizing: 'border-box' }}>
        <div style={{ width: '100%', maxWidth: '420px', textAlign: 'center', padding: '30px 22px', borderRadius: '24px', background: 'rgba(20,16,30,0.95)', border: '1px solid rgba(139,92,246,0.5)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
          <div style={{ fontSize: '56px', marginBottom: '12px' }}>🛠️</div>
          <h2 style={{ margin: '0 0 12px', color: '#c4b5fd' }}>سوريانا تحت الصيانة</h2>
          <p style={{ color: '#d1d5db', lineHeight: '1.8', margin: '0 0 12px' }}>
            التطبيق متوقف مؤقتًا لإجراء بعض التحديثات والتحسينات.
          </p>
          {maintenanceAnnouncement && (
            <div style={{ marginTop: '16px', padding: '12px', borderRadius: '14px', background: 'rgba(255,255,255,0.06)', color: '#fff', lineHeight: '1.7' }}>
              {maintenanceAnnouncement}
            </div>
          )}
          <p style={{ color: '#9ca3af', fontSize: '12px', marginTop: '18px' }}>
            يرجى المحاولة مرة أخرى لاحقًا ❤️
          </p>
          <button
            type="button"
            onClick={handleLogout}
            style={{ marginTop: '16px', width: '100%', height: '44px', borderRadius: '22px', background: 'transparent', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', fontWeight: 'bold' }}
          >
            تسجيل الخروج
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', minHeight: '100vh', background: '#0e0816', color: '#fff', direction: 'rtl', fontFamily: 'sans-serif' }}>
      {page === "login" && (
        <div style={{ padding: '20px', width: '100%', maxWidth: '400px', marginTop: '20vh', textAlign: 'center' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff6b8b, #ec4899)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '38px', margin: '0 auto 16px auto' }}>❤️</div>
          <h1>سوريانا Premium</h1><p style={{ color: '#9ca3af', fontSize: '13px' }}>دردشة تعارف حقيقي ومكالمات آمنة</p>
          {authError && <p style={{ color: "#ef4444", fontSize: "13px", marginTop: "10px" }}>{authError}</p>}
          <button type="button" onClick={handleGoogleLogin} style={{ marginTop: '12px', width: '100%', height: '48px', borderRadius: '24px', background: '#fff', border: 'none', color: '#111', fontWeight: 'bold', fontSize: '14px' }}>
            🔵 المتابعة باستخدام Google
          </button>
<button type="button" disabled style={{ marginTop: '12px', width: '100%', height: '45px', borderRadius: '22px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#9ca3af', opacity: 0.7 }}>
  التسجيل برقم هاتف — غير متاح
</button>
          
        </div>
      )}
      {page === "admin_lock" && (
        <div style={{ padding: '20px', width: '100%', maxWidth: '400px', marginTop: '20vh', textAlign: 'center' }}>
          <h3>التحقق للمدير 👑</h3><input type="password" style={{ background: '#1e1b29', border: '1px solid #3b82f6', color: '#fff', padding: '10px', borderRadius: '10px', textAlign: 'center' }} onChange={e => setAdminPass(e.target.value)} />
          <button type="button" style={{ marginTop: '12px', width: '100%', height: '40px', borderRadius: '20px', background: '#3b82f6', border: 'none', color: '#fff' }} onClick={() => { if(isAdmin) { setTab("admin_panel"); setPage("app"); } }}>تأكيد فتح اللوحة</button>
        </div>
      )}
      {page === "register" && (
        <div style={{ padding: '20px', width: '100%', maxWidth: '400px', marginTop: '8vh', textAlign: 'right' }}>
          <div style={{ textAlign: 'center', marginBottom: '14px' }}>
<h2>👤 البيانات الشخصية</h2>
<p style={{ color: '#9ca3af', fontSize: '12px' }}>أكمل ملفك للبدء بالتعارف الفوري</p>
<button type="button" onClick={() => setPage("login")} style={{
marginTop:"8px",padding:"8px 16px",borderRadius:"18px",
border:"1px solid rgba(255,255,255,.12)",background:"rgba(255,255,255,.05)",
color:"#fff",fontWeight:"700"
}}>↩️ رجوع لتسجيل الدخول</button>
</div>
          <form onSubmit={handleRegisterSubmit} className="auth-container" style={{ padding: '20px', borderRadius: '20px', background: 'rgba(255,255,255,0.02)' }}>
            <label style={{ fontSize: '13px', color: '#9ca3af' }}>البريد الإلكتروني:</label>
            <input type="email" placeholder="example@gmail.com" value={form.email || ""} className="input-custom" style={{ marginBottom: '12px', marginTop: '4px' }} onChange={e=>setForm({...form, email:e.target.value})} />
            <label style={{ fontSize: '13px', color: '#9ca3af' }}>كلمة المرور:</label>
            <input type="password" placeholder="6 أحرف على الأقل" value={form.password || ""} className="input-custom" style={{ marginBottom: '12px', marginTop: '4px' }} onChange={e=>setForm({...form, password:e.target.value})} />
            <label style={{ fontSize: '13px', color: '#9ca3af' }}>كود الدعوة (اختياري):</label>
            <input type="text" placeholder="أدخل كود الدعوة إذا لديك" value={form.referral_code || ""} className="input-custom" style={{ marginBottom: '12px', marginTop: '4px' }} onChange={e=>setForm({...form, referral_code:e.target.value.trim()})} />
            <label style={{ fontSize: '13px', color: '#9ca3af' }}>الاسم الظاهر:</label><input type="text" defaultValue={form.name} className="input-custom" style={{ marginBottom: '12px', marginTop: '4px' }} onChange={e=>setForm({...form, name:e.target.value})} />
            <label style={{ fontSize: '13px', color: '#9ca3af' }}>تاريخ الميلاد:</label>
<div style={{display:"flex",gap:"8px",marginTop:"4px",marginBottom:"12px"}}>
<select className="input-custom" value={birthDay} onChange={e=>{
const d=e.target.value;
updateBirthDate(d,birthMonth,birthYear);
}} style={{flex:1,color:"#fff"}}><option value="">اليوم</option>
{Array.from({length:31},(_,i)=>String(i+1).padStart(2,"0")).map(d=><option key={d} value={d}>{Number(d)}</option>)}
</select>
<select className="input-custom" value={birthMonth} onChange={e=>updateBirthDate(birthDay,e.target.value,birthYear)} style={{flex:1,color:"#fff"}}><option value="">الشهر</option>
{Array.from({length:12},(_,i)=>String(i+1).padStart(2,"0")).map(m=><option key={m} value={m}>{Number(m)}</option>)}
</select>
<select className="input-custom" value={birthYear} onChange={e=>updateBirthDate(birthDay,birthMonth,e.target.value)} style={{flex:1,color:"#fff"}}><option value="">السنة</option>
{Array.from({length:100},(_,i)=>String(new Date().getFullYear()-13-i)).map(y=><option key={y} value={y}>{y}</option>)}
</select>
</div>
            <label style={{ fontSize: '13px', color: '#9ca3af' }}>المحافظة:</label>
<select value={form.city || ""} className="input-custom" style={{ color: '#fff', marginBottom: '12px', marginTop: '4px' }} onChange={e=>setForm({...form, city:e.target.value})}>
<option value="">اختر المحافظة</option>
              {["دمشق", "ريف دمشق", "حلب", "حمص", "حماة", "اللاذقية", "طرطوس", "السويداء", "درعا", "الرقة", "إدلب", "دير الزور", "الحسكة", "القنيطرة"].map(c => <option key={c} value={c} style={{background:'#110a1c'}}>{c}</option>)}
            </select>
            <label style={{ fontSize: '13px', color: '#9ca3af' }}>الجنس:</label>
            <div style={{ display: 'flex', gap: '10px', marginTop: '4px', marginBottom: '16px' }}>
              <button type="button" style={{ flex: 1, height: '36px', borderRadius: '10px', background: form.gender==='ذكر'?'#ff6b8b':'rgba(255,255,255,0.04)', color: '#fff', border: 'none' }} onClick={()=>setForm({...form, gender:'ذكر'})}>ذكر</button>
              <button type="button" style={{ flex: 1, height: '36px', borderRadius: '10px', background: form.gender==='أنثى'?'#ff6b8b':'rgba(255,255,255,0.04)', color: '#fff', border: 'none' }} onClick={()=>setForm({...form, gender:'أنثى'})}>أنثى</button>
            </div>
            <button type="submit" disabled={authLoading} className="btn-primary-custom" style={{ width: '100%', height: '46px', borderRadius: '23px', background: 'linear-gradient(45deg, #ffbd8a, #f43f5e)', color: '#000', fontWeight: 'bold' }}>
              {authLoading ? "جارٍ إنشاء الحساب..." : "حفظ الحساب والدخول ❯"}
            </button>
          </form>
        </div>
      )}
      {page === "app" && (
        <div style={{ width: '100%', maxWidth: '480px', padding: '16px 16px 100px 16px', position: 'relative', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}><div style={{ background: 'rgba(255,255,255,0.06)', padding: '6px 12px', borderRadius: '20px', fontSize: '13px', color: '#fca5a5' }}>⭐ {userPoints} نقطة</div><div style={{ fontSize: '14px', fontWeight: 'bold', background: 'linear-gradient(45deg, #ff6b8b, #8a2be2)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>سوريانا Premium</div></div>
{maintenanceAnnouncement && (
  <div style={{
    marginBottom: '14px',
    padding: '12px 14px',
    borderRadius: '14px',
    background: 'rgba(255,107,139,0.10)',
    border: '1px solid rgba(255,107,139,0.25)',
    color: '#fff',
    fontSize: '14px',
    lineHeight: '1.7',
    textAlign: 'right'
  }}>
    📢 {maintenanceAnnouncement}
  </div>
)}
  <button onClick={async ()=>{
  const next = !showNotifications;
  setShowNotifications(next);
  if(next) await markNotificationsAsRead();
}} style={{background:"transparent",border:"none",fontSize:"22px",color:"#fff"}}>🔔 {notifications.filter(n=>Number(n.is_read)===0).length || ""}</button>{showNotifications && <div onClick={(e)=>e.stopPropagation()} style={{position:"absolute",top:"50px",right:"10px",width:"280px",maxHeight:"70vh",overflowY:"auto",background:"#1e1b29",padding:"10px",borderRadius:"15px",zIndex:999,color:"#fff"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
<div onClick={()=>setShowNotifications(false)} style={{fontSize:"20px",width:"25px",height:"25px",cursor:"pointer"}}>✕</div>
{notifications.length>0 && <button onClick={async()=>{
if(!window.confirm("هل تريد مسح سجل الإشعارات بالكامل؟")) return;
try{
const response=await fetch(`${API_BASE}/api/notifications`,{
method:"DELETE"
});
const data=await response.json();
if(data.success){
setNotifications([]);
}
}catch(e){
console.error("NOTIFICATIONS DELETE ERROR:",e);
}
}} style={{background:"transparent",border:"1px solid #777",color:"#fff",borderRadius:"8px",padding:"5px 9px",cursor:"pointer"}}>🗑️ مسح السجل</button>}
</div>{notifications.length===0?<div style={{padding:"15px",textAlign:"center"}}>لا يوجد إشعارات</div>:notifications.map(n=><div key={n.id} style={{padding:"12px",marginBottom:"8px",background:"#292535",borderRadius:"10px",cursor:"pointer"}} onClick={async()=>{if(Number(n.is_read)===0){try{await fetch(`${API_BASE}/api/notifications/read/${n.id}`,{method:"POST"});setNotifications(prev=>prev.map(x=>x.id===n.id?{...x,is_read:1}:x));}catch(e){console.error("NOTIFICATION READ ERROR:",e);}}}}><div style={{fontWeight:"bold",marginBottom:"4px"}}>{n.title}</div><div style={{fontSize:"14px",opacity:.85}}>{n.message}</div></div>)}</div>}
          {tab === "admin_panel" && isAdmin && (
            <div style={{ padding: '20px', borderRadius: '24px', background: 'rgba(20,16,30,0.95)', border: '1px solid #fbbf24', textAlign: 'right' }}>
              <h2 style={{ color: '#fbbf24', textAlign: 'center', marginBottom: '16px', fontSize: '18px' }}>👑 لوحة الإدارة العليا لـ جعفر ليلى</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                <button type="button" onClick={()=>setAdminSubTab("users")} style={{ height: '36px', background: adminSubTab==='users'?'#fbbf24':'#1e1b29', border:'none', color:adminSubTab==='users'?'#000':'#fff', borderRadius:'10px', fontSize:'11px', fontWeight:'bold' }}>👥 المشتركين</button>
                <button type="button" onClick={()=>setAdminSubTab("verify")} style={{ height: '36px', background: adminSubTab==='verify'?'#34d399':'#1e1b29', border:'none', color:adminSubTab==='verify'?'#000':'#fff', borderRadius:'10px', fontSize:'11px', fontWeight:'bold' }}>📸 التوثيق</button>
                <button type="button" onClick={()=>setAdminSubTab("withdraw")} style={{ height: '36px', background: adminSubTab==='withdraw'?'#ef4444':'#1e1b29', border:'none', color:adminSubTab==='withdraw'?'#000':'#fff', borderRadius:'10px', fontSize:'11px', fontWeight:'bold' }}>📥 السحب</button>
                <button type="button" onClick={()=>setAdminSubTab("money")} style={{ height: "36px", background: adminSubTab==="money"?"#eab308":"#1e1b29", border:"none", color: adminSubTab==="money"?"#000":"#fff", borderRadius:"10px", fontSize:"11px", fontWeight:"bold" }}>💰 إدارة المال</button>
                <button type="button" onClick={()=>setAdminSubTab("control")} style={{ height: "36px", background: adminSubTab==="control"?"#8b5cf6":"#1e1b29", border:"none", color: adminSubTab==="control"?"#000":"#fff", borderRadius:"10px", fontSize:"11px", fontWeight:"bold" }}>⚙️ التحكم العام</button>
                <button type="button" onClick={()=>setAdminSubTab("stats")} style={{ height: "36px", background: adminSubTab==="stats"?"#22c55e":"#1e1b29", border:"none", color: adminSubTab==="stats"?"#000":"#fff", borderRadius:"10px", fontSize:"11px", fontWeight:"bold" }}>📊 الإحصائيات</button>
                <button type="button" onClick={()=>setAdminSubTab("reports")} style={{ height: '36px', background: adminSubTab==='reports'?'#f59e0b':'#1e1b29', border:'none', color:adminSubTab==='reports'?'#000':'#fff', borderRadius:'10px', fontSize:'11px', fontWeight:'bold' }}>⚠️ الإبلاغات</button>
<button type="button" onClick={()=>setAdminSubTab("settings")} style={{ height: '36px', background: adminSubTab==='settings'?'#60a5fa':'#1e1b29', border:'none', color:adminSubTab==='settings'?'#000':'#fff', borderRadius:'10px', fontSize:'11px', fontWeight:'bold' }}>⚙️ الإعدادات</button>
<button type="button" onClick={()=>setAdminSubTab("security")} style={{ height: '36px', background: adminSubTab==='security'?'#ef4444':'#1e1b29', border:'none', color:adminSubTab==='security'?'#fff':'#fff', borderRadius:'10px', fontSize:'11px', fontWeight:'bold' }}>⚠️ الأمان</button>
<button type="button" onClick={()=>setAdminSubTab("moderators")} style={{ height: '36px', background: adminSubTab==='moderators'?'#8b5cf6':'#1e1b29', border:'none', color:'#fff', borderRadius:'10px', fontSize:'11px', fontWeight:'bold' }}>👮 المشرفين</button>
              </div>
              {adminSubTab === "users" && <AdminUsers />}
              {adminSubTab === "verify" && <AdminVerification />}
              {adminSubTab === "withdraw" && <AdminWithdraw />}
              {adminSubTab === "money" && <AdminMoney />}
              {adminSubTab === "control" && <AdminControl />}
              {adminSubTab === "stats" && <AdminStats />}
              {adminSubTab === "reports" && <AdminReports />}
              {adminSubTab === "settings" && <AdminSettings />}
{adminSubTab === "security" && <AdminSecurity />}
{adminSubTab === "moderators" && <AdminModerators />}
              <button type="button" style={{ width: '100%', height: '40px', marginTop: '20px', background: 'rgba(255,255,255,0.05)', color: '#fff', border: 'none', borderRadius: '20px' }} onClick={() => { setPage("login"); setIsAdmin(false); }}>تسجيل خروج المدير ❮</button>
            </div>
          )}
          {tab === "discover" && (
  <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
    {!currentPerson ? (
      <div className="auth-container" style={{padding:'40px 20px',textAlign:'center'}}>
        {usersLoading ? "جاري تحميل المستخدمين..." : "لا يوجد مستخدمون آخرون حالياً"}
      </div>
    ) : (
      <>
        <div style={{
          width:'100%',
          height:'380px',
          borderRadius:'28px',
          backgroundImage:`url('${discoverImage}')`,
          backgroundSize:'cover',
          backgroundPosition:'center',
          position:'relative'
        }}>
          <div style={{position:'absolute',top:'16px',right:'16px'}}>
            {Number(currentPerson.is_verified) === 1 && (
              <span style={{
                background:'rgba(59,130,246,0.25)',
                backdropFilter:'blur(8px)',
                color:'#60a5fa',
                padding:'6px 12px',
                borderRadius:'14px',
                fontSize:'12px',
                fontWeight:'bold'
              }}>
                ✓ موثقة
              </span>
            )}
          </div>

          <div style={{
            position:'absolute',
            bottom:'0',
            left:'0',
            right:'0',
            padding:'24px 20px',
            background:'linear-gradient(to top,#0e0816 40%,transparent 100%)',
            textAlign:'right'
          }}>
            <h2>{currentPerson.name || "مستخدم"}، {currentPerson.age || "—"} سنة</h2>
            <p style={{color:'#9ca3af',fontSize:'12px'}}>
              📍 {currentPerson.city || "غير محدد"}
            </p>
            <p style={{fontSize:'11px',color:'#6b7280'}}>
              🆔 {currentPerson.public_id}
  </p>
  <p style={{fontSize:'12px',fontWeight:'800',color:'#fff',marginTop:'6px'}}>
    {(String(currentPerson.gender || "") === "أنثى" || String(currentPerson.gender || "") === "بنت"
      ? "❤️"
      : "⚔️")} L.{Number(currentPerson.powerLevel || 0)}
  </p>
          </div>
        </div>

        <div style={{display:'flex',gap:'10px'}}>
          <button
            type="button"
            onClick={()=>{
              setSelectedChatUser(currentPerson);
              setTab("chat");
            }}
            style={{
              flex:1.4,
              height:'52px',
              borderRadius:'24px',
              background:'linear-gradient(45deg,#f43f5e,#ec4899)',
              border:'none',
              color:'#fff',
              fontWeight:'bold'
            }}
          >
            💬 أرسل رسالة
          </button>

          <button
            type="button"
            disabled={discoverLikeLoading}
            onClick={async ()=>{
              if(!currentPerson || discoverLikeLoading) return;

              const targetId = Number(currentPerson.id);
              if(!Number.isInteger(targetId) || targetId <= 0) return;

              setDiscoverLikeLoading(true);

              try {
                const data = await apiRequest(
                  "/api/profile-likes/" + targetId,
                  {
                    method: discoverLiked ? "DELETE" : "POST"
                  }
                );

                if(!data.success){
                  throw new Error(data.message || "تعذر تحديث الإعجاب");
                }

                setDiscoverLiked(Boolean(data.liked));
              } catch(err) {
                console.error("DISCOVER LIKE ERROR:", err);
                alert(err.message || "تعذر تحديث الإعجاب");
              } finally {
                setDiscoverLikeLoading(false);
              }
            }}
            style={{
              flex:1,
              height:'52px',
              borderRadius:'24px',
              background: discoverLiked
                ? 'rgba(255,70,110,0.15)'
                : 'rgba(255,255,255,0.04)',
              border: discoverLiked
                ? '1px solid rgba(255,70,110,0.35)'
                : '1px solid rgba(255,255,255,0.08)',
              color:'#fff',
              fontWeight:'bold',
              opacity:discoverLikeLoading ? 0.7 : 1
            }}
          >
            {discoverLiked ? "❤️ معجب" : "🤍 اضغط للاعجاب"}
          </button>
        </div>

        <button
          type="button"
          disabled={discoverUsers.length <= 1}
          onClick={()=>{
            setDiscoverIndex(prev =>
              prev + 1 >= discoverUsers.length ? 0 : prev + 1
            );
          }}
          style={{
            width:'100%',
            height:'46px',
            borderRadius:'20px',
            background:'rgba(255,255,255,0.03)',
            color:'#ff6b8b',
            border:'none',
            fontWeight:'bold',
            opacity:discoverUsers.length <= 1 ? 0.5 : 1
          }}
        >
          التالي ❯
        </button>
      </>
    )}
  </div>
)}

{tab === "users" && (
            <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>

              <input
                placeholder="🔍 ابحث عن مستخدم..."
                value={searchText}
                onChange={(e)=>{
                  setSearchText(e.target.value);
                  loadUsers(e.target.value);
                }}
                style={{
                  height:"45px",
                  borderRadius:"22px",
                  border:"none",
                  padding:"0 18px",
                  background:"#1e1b29",
                  color:"#fff"
                }}
              />

              {usersLoading && <div style={{textAlign:"center"}}>جاري البحث...</div>}

              {searchUsers.map(u=>(
                <div key={u.id}
                style={{
                  background:"rgba(255,255,255,0.05)",
                  padding:"14px",
                  borderRadius:"18px",
                  display:"flex",
                  justifyContent:"space-between",
                  alignItems:"center"
                }}>

                  <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={async () => {
                        try {
                          const response = await fetch(`/api/users/${u.id}/profile`, {
                            credentials: "include"
                          });
                          const data = await response.json();

                          if (!response.ok || !data.success) {
                            alert(data.message || "تعذر فتح البروفايل");
                            return;
                          }

                          window.dispatchEvent(
                            new CustomEvent("suriana:open-user-profile", {
                              detail: data.profile
                            })
                          );
                        } catch (error) {
                          console.error("OPEN USERS PROFILE ERROR:", error);
                          alert("تعذر فتح البروفايل");
                        }
                      }}
                      style={{
                        width:"58px",
                        height:"58px",
                        minWidth:"58px",
                        padding:0,
                        borderRadius:"50%",
                        border:u.role==="owner" ? "3px solid #facc15" : "3px solid #ff6b8b",
                        background:u.avatar
                          ? `url('${u.avatar}') center/cover no-repeat`
                          : "rgba(255,255,255,0.08)",
                        cursor:"pointer",
                        display:"flex",
                        alignItems:"center",
                        justifyContent:"center",
                        overflow:"visible",
                        position:"relative",
                        boxShadow:u.role==="owner" ? "0 0 22px rgba(250,204,21,.45)" : "none"
                      }}
                    >
                      {!u.avatar && <span style={{fontSize:"24px"}}>👤</span>}{u.role==="owner" && <span style={{position:"absolute",top:"-18px",left:"50%",transform:"translateX(-50%)",fontSize:"25px",zIndex:5}}>👑</span>}
                    </button>

                    <div style={{textAlign:"right"}}>
                    <b style={{color:u.role==="owner" ? "#facc15" : "#fff",fontWeight:"900"}}>{u.role==="owner" ? "『 admin jaafar 』" : u.name}</b>
                    <div style={{color:"#9ca3af"}}>
                      📍 {u.city || "غير محدد"}
                    </div>
                    <div style={{fontSize:"12px"}}>
                      🆔 {u.public_id}
                    </div>
                    <div style={{fontSize:"12px",fontWeight:"800",color:"#fff",marginTop:"5px"}}>
                      {(String(u.gender || "") === "أنثى" || String(u.gender || "") === "بنت"
                        ? "❤️"
                        : "⚔️")} L.{Number(u.powerLevel || 0)}
                    </div>
                  </div>

                  <div style={{display:"flex",gap:"6px"}}>
                    <button
                      onClick={()=>{ 
                        setSelectedChatUser(u);
                        setTab("chat");
                      }}
                      style={{
                        background:"#ec4899",
                        color:"#fff",
                        border:"none",
                        borderRadius:"18px",
                        padding:"8px"
                      }}>
                        💬
                      </button>

                  </div>

                </div>
                          </div>
))}

            </div>
          )}

          {tab === "chat" && <ChatView userPoints={userPoints} setUserPoints={setUserPoints} form={form} initialChat={selectedChatUser} />}
          {tab === "wallet" && (
  <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
    <div className="auth-container" style={{textAlign:'center',padding:'24px'}}>
      <div>رصيد محفظتك الحالي</div>
      <div style={{fontSize:'42px',fontWeight:'bold'}}>{userPoints} نقطة</div>
    </div>

    {form.gender === "ذكر" && (
      <div>
        <div style={{marginBottom:'10px'}}>💳 باقات الشحن</div>

        {[{p:500,s:"٥٠,٠٠٠"},{p:1200,s:"١٠٠,٠٠٠"},{p:3000,s:"٢٥٠,٠٠٠"}].map(b=>(
          <div key={b.p}
          className="auth-container"
          style={{padding:'16px',marginBottom:'10px',cursor:'pointer'}}
          onClick={()=>setActiveCharge(b)}>
            <b>{b.p} نقطة</b>
            <div>{b.s} ل.س</div>
          </div>
        ))}
      </div>
    )}

    {form.gender === "أنثى" && (
      <button className="btn-primary-custom"
      onClick={()=>setActiveCharge({p:5000,s:"٥٠,٠٠٠"})}>
      📥 طلب سحب كاش
      </button>
    )}

    {activeCharge && form.gender === "ذكر" &&
      <ChargeForm
       points={activeCharge.p}
       amountSyr={activeCharge.s}
       gateways={{sham:paymentGateways.sham_cash,syriatel:paymentGateways.syriatel_cash}}
       onCancel={()=>setActiveCharge(null)}
       onAddLog={addWalletLog}
      />
    }

    {activeCharge && form.gender === "أنثى" &&
      <WithdrawForm
       userPoints={userPoints}
       setUserPoints={setUserPoints}
       onCancel={()=>setActiveCharge(null)}
       onAddLog={addWalletLog}
      />
    }

    <div style={{marginTop:"20px"}}>
      <div style={{fontSize:"15px",fontWeight:"bold",marginBottom:"10px"}}>
        📊 سجل عمليات الشحن
      </div>

      {walletLogs.length === 0 ? (
        <div style={{color:"#9ca3af",textAlign:"center"}}>
          لا يوجد عمليات حالياً
        </div>
      ) : (
        walletLogs.map(log => {
          const points = Number(log.points || 0);
          const isIncome = points > 0;

          const typeLabels = {
            charge: "شحن نقاط",
            admin_charge: "شحن من الإدارة",
            withdraw_refund: "استرجاع سحب",
            withdraw: "سحب",
            call: "مكالمة صوتية",
            call_income: "أرباح مكالمة",
            gift: "هدية",
            message: "رسالة"
          };

          const typeLabel = typeLabels[log.type] || log.type || "عملية محفظة";

          return (
            <div key={log.id} style={{
              background:"rgba(255,255,255,0.04)",
              padding:"14px",
              borderRadius:"16px",
              marginBottom:"8px"
            }}>
              <div style={{fontWeight:"bold"}}>
                {log.type === "charge_request"
                  ? "🟡 طلب شحن"
                  : `${isIncome ? "🟢" : "🔴"} ${typeLabel}`}
              </div>

              <div style={{
                color:log.type === "charge_request"
                  ? "#fbbf24"
                  : isIncome
                  ? "#4ade80"
                  : "#f87171",
                fontWeight:"bold",
                marginTop:"5px"
              }}>
                {log.type === "charge_request"
                  ? `💳 ${points.toLocaleString("ar-SY")} نقطة`
                  : `${isIncome ? "+" : ""}${points.toLocaleString("ar-SY")} نقطة`}
              </div>

              {log.type === "charge_request" && (
                <div style={{
                  color:"#fbbf24",
                  fontWeight:"bold",
                  marginTop:"4px"
                }}>
                  ⏳ قيد مراجعة الإدارة
                </div>
              )}

              {log.description && (
                <div style={{
                  color:"#d1d5db",
                  fontSize:"13px",
                  marginTop:"4px"
                }}>
                  {log.description}
                </div>
              )}

              <div style={{
                fontSize:"12px",
                color:"#9ca3af",
                marginTop:"6px"
              }}>
                🕒 {log.created_at
                  ? new Date(String(log.created_at).replace(" ", "T") + "Z")
                      .toLocaleString("ar-SY")
                  : "—"}
              </div>
            </div>
          );
        })
      )}
    </div>
  </div>
)}
{viewedProfile && (
  <div
    style={{
      position:"fixed",
      inset:0,
      zIndex:10000,
      background:"rgba(5,3,10,.94)",
      backdropFilter:"blur(16px)",
      overflowY:"auto",
      padding:"20px 14px 100px",
      direction:"rtl"
    }}
  >
    <div
      style={{
        maxWidth:"520px",
        margin:"0 auto",
        position:"relative",
        borderRadius:"32px",
        padding:"24px 16px",
        background:viewedProfile.role === "owner"
          ? "linear-gradient(145deg,#17100a,#09070d 55%,#1b1007)"
          : "linear-gradient(145deg,rgba(40,30,65,.98),rgba(18,12,30,.99))",
        border:viewedProfile.role === "owner"
          ? "1px solid rgba(250,204,21,.55)"
          : "1px solid rgba(255,107,139,.22)",
        boxShadow:viewedProfile.role === "owner"
          ? "0 0 45px rgba(234,179,8,.16),0 25px 90px rgba(0,0,0,.75)"
          : "0 25px 80px rgba(0,0,0,.55)"
      }}
    >

      <button
        type="button"
        onClick={() => setViewedProfile(null)}
        style={{
          position:"absolute",
          top:"14px",
          left:"14px",
          width:"38px",
          height:"38px",
          borderRadius:"50%",
          border:"1px solid rgba(255,255,255,.12)",
          background:"rgba(255,255,255,.06)",
          color:"#fff",
          fontSize:"20px",
          cursor:"pointer",
          zIndex:5
        }}
      >
        ×
      </button>

      {viewedProfile.role === "owner" ? (
        <>
          <div style={{
            textAlign:"center",
            color:"#facc15",
            fontSize:"11px",
            fontWeight:"900",
            letterSpacing:"3px",
            marginBottom:"10px"
          }}>
            ♛  SURIANA ROYAL ADMIN  ♛
          </div>

          <div style={{
            position:"relative",
            width:"126px",
            height:"126px",
            margin:"10px auto 18px",
            borderRadius:"50%",
            padding:"5px",
            background:"linear-gradient(135deg,#fff7b2,#facc15,#a16207,#fde68a,#facc15)",
            boxShadow:"0 0 0 6px rgba(250,204,21,.10),0 0 35px rgba(234,179,8,.35)"
          }}>
            <div style={{
              width:"100%",
              height:"100%",
              borderRadius:"50%",
              overflow:"hidden",
              background:"linear-gradient(145deg,#241507,#09070b)",
              display:"flex",
              alignItems:"center",
              justifyContent:"center"
            }}>
              {viewedProfile.avatar ? (
                <img
                  src={viewedProfile.avatar}
                  alt="صورة المدير"
                  style={{
                    width:"100%",
                    height:"100%",
                    objectFit:"cover"
                  }}
                />
              ) : (
                <span style={{fontSize:"52px"}}>👑</span>
              )}
            </div>

            <div style={{
              position:"absolute",
              top:"-27px",
              left:"50%",
              transform:"translateX(-50%)",
              fontSize:"43px",
              filter:"drop-shadow(0 4px 8px rgba(0,0,0,.7))"
            }}>
              👑
            </div>
          </div>

          <div style={{
            textAlign:"center",
            fontSize:"29px",
            fontWeight:"1000",
            color:"#facc15",
            textShadow:"0 0 18px rgba(250,204,21,.35)",
            marginBottom:"5px"
          }}>
            『 admin jaafar 』
          </div>

          <div style={{
            textAlign:"center",
            color:"#fde68a",
            fontSize:"13px",
            fontWeight:"900",
            marginBottom:"20px"
          }}>
            
          </div>

          <div style={{
            padding:"17px",
            borderRadius:"22px",
            background:"linear-gradient(135deg,rgba(250,204,21,.10),rgba(255,255,255,.025))",
            border:"1px solid rgba(250,204,21,.25)",
            textAlign:"center",
            marginBottom:"14px"
          }}>
            <div style={{
              color:"#fef3c7",
              fontSize:"14px",
              fontWeight:"900"
            }}>
              
            </div>
            <div style={{
              color:"#a1a1aa",
              fontSize:"12px",
              marginTop:"6px"
            }}>
              
            </div>
          </div>

          <div style={{
            display:"grid",
            gridTemplateColumns:"repeat(2,minmax(0,1fr))",
            gap:"10px"
          }}>
            <div className="profile-stat" style={{
              borderColor:"rgba(250,204,21,.20)"
            }}>
              <span>♛</span>
              <small>الرتبة</small>
              <strong style={{color:"#facc15"}}>ADMIN</strong>
            </div>

            <div className="profile-stat" style={{
              borderColor:"rgba(250,204,21,.20)"
            }}>
              <span>∞</span>
              <small>المستوى</small>
              <strong style={{color:"#facc15"}}>∞</strong>
            </div>

            <div className="profile-stat" style={{
              borderColor:"rgba(250,204,21,.20)"
            }}>
              <span>🆔</span>
              <small>رقم العضوية</small>
              <strong>{viewedProfile.public_id || "—"}</strong>
            </div>

            <div className="profile-stat" style={{
              borderColor:"rgba(250,204,21,.20)"
            }}>
              <span>⚜️</span>
              <small>⚜️ الإدارة العليا</small>
              <strong style={{color:"#facc15",fontSize:"14px"}}>SURIANA ❤️💚</strong>
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{
            width:"108px",
            height:"108px",
            margin:"8px auto 14px",
            borderRadius:"50%",
            border:"4px solid #ff6b8b",
            overflow:"hidden",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            background:"rgba(255,255,255,.06)",
            boxShadow:"0 0 0 7px rgba(192,132,252,.12)"
          }}>
            {viewedProfile.avatar ? (
              <img
                src={viewedProfile.avatar}
                alt="صورة البروفايل"
                style={{width:"100%",height:"100%",objectFit:"cover"}}
              />
            ) : (
              <span style={{fontSize:"48px"}}>👤</span>
            )}
          </div>

          <div style={{
            textAlign:"center",
            color:"#fff",
            fontSize:"23px",
            fontWeight:"900"
          }}>
            {viewedProfile.name || "مستخدم"}
            {Boolean(viewedProfile.is_verified) && (
              <span style={{
                color:"#22d3ee",
                fontSize:"15px",
                marginRight:"6px"
              }}>
                ✓
              </span>
            )}
          </div>

          {Boolean(viewedProfile.is_verified) && (
            <div style={{
              textAlign:"center",
              color:"#67e8f9",
              fontSize:"12px",
              fontWeight:"800",
              marginTop:"5px"
            }}>
              ✓ حساب موثق
            </div>
          )}

          <div style={{
            marginTop:"20px",
            padding:"16px",
            borderRadius:"20px",
            background:"rgba(255,255,255,.045)",
            border:"1px solid rgba(255,255,255,.06)",
            display:"flex",
            alignItems:"center",
            gap:"12px"
          }}>
            <div style={{fontSize:"30px"}}>
              {(String(viewedProfile.gender || "") === "أنثى" ||
                String(viewedProfile.gender || "") === "بنت") ? "❤️" : "⚔️"}
            </div>

            <div>
              <div style={{
                color:"#9ca3af",
                fontSize:"12px",
                fontWeight:"700"
              }}>
                {(String(viewedProfile.gender || "") === "أنثى" ||
                  String(viewedProfile.gender || "") === "بنت")
                  ? "الجاذبية"
                  : "الثروة"}
              </div>

              <div style={{
                color:"#c4b5fd",
                fontSize:"11px",
                marginTop:"2px"
              }}>
                {(String(viewedProfile.gender || "") === "أنثى" ||
                  String(viewedProfile.gender || "") === "بنت")
                  ? `الجاذبية ❤️ • L.${Number(viewedProfile.powerLevel || 0)}`
                  : `الثروة ⚔️ • L.${Number(viewedProfile.powerLevel || 0)}`}
              </div>
            </div>
          </div>

          <div style={{
            display:"grid",
            gridTemplateColumns:"repeat(2,minmax(0,1fr))",
            gap:"10px",
            marginTop:"14px"
          }}>
            <div className="profile-stat">
              <span>🆔</span>
              <small>رقم العضوية</small>
              <strong>{viewedProfile.public_id || "—"}</strong>
            </div>

            <div className="profile-stat">
              <span>⚧</span>
              <small>الجنس</small>
              <strong>{viewedProfile.gender || "—"}</strong>
            </div>

            <div className="profile-stat">
              <span>🎂</span>
              <small>تاريخ الميلاد</small>
              <strong>{viewedProfile.birth_date || "—"}</strong>
            </div>

            <div className="profile-stat">
              <span>📅</span>
              <small>تاريخ التسجيل</small>
              <strong>
                {viewedProfile.created_at
                  ? String(viewedProfile.created_at).slice(0,10)
                  : "—"}
              </strong>
            </div>

            <div className="profile-stat profile-likes-stat">
              <span>❤️</span>
              <small>الإعجابات</small>
              <strong>
                {Number(viewedProfile.likesCount || 0).toLocaleString("ar-SY")}
              </strong>
            </div>
          </div>
        </>
      )}
    </div>
  </div>
)}

{tab === "profile" && (
  <div className="profile-premium">

    <div className="profile-premium-card">

      <label
        className="profile-avatar-premium"
        style={{ cursor: profileAvatarSaving ? "default" : "pointer" }}
      >
        {user?.avatar ? (
          <img
            src={user.avatar}
            alt="صورة البروفايل"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              borderRadius: "50%"
            }}
          />
        ) : (
          <span>👤</span>
        )}

        {!profileAvatarSaving && (
          <span
            style={{
              position: "absolute",
              right: "-2px",
              bottom: "-2px",
              width: "30px",
              height: "30px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#7c3aed",
              border: "2px solid #110d19",
              fontSize: "15px"
            }}
          >
            📷
          </span>
        )}

        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          disabled={profileAvatarSaving}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) saveProfileAvatar(file);
            e.target.value = "";
          }}
        />
      </label>

      {editingProfileName ? (
        <div className="profile-name-edit-premium">
          <input
            className="profile-name-input-premium"
            value={profileNameInput}
            onChange={(e) => setProfileNameInput(e.target.value)}
            maxLength={40}
            autoFocus
          />

          <div className="profile-name-actions-premium">
            <button
              type="button"
              className="profile-name-save-premium"
              onClick={saveProfileName}
              disabled={profileNameSaving}
            >
              {profileNameSaving ? "جاري الحفظ..." : "حفظ"}
            </button>

            <button
              type="button"
              className="profile-name-cancel-premium"
              onClick={() => {
                setEditingProfileName(false);
                setProfileNameInput("");
              }}
              disabled={profileNameSaving}
            >
              إلغاء
            </button>
          </div>
        </div>
      ) : (
        <div className="profile-name-row-premium">
          <div className="profile-name-premium">
            {user?.name || "مستخدم"}
          </div>

          <button
            type="button"
            className="profile-name-edit-button-premium"
            onClick={() => {
              setProfileNameInput(user?.name || "");
              setEditingProfileName(true);
            }}
            aria-label="تعديل الاسم"
          >
            ✏️
          </button>
        </div>
      )}

      {isVerified && (
        <div className="profile-verified-premium">
          ✓ حساب موثق
        </div>
      )}

      <div className="profile-location-premium">
        📍 {user?.city || "غير محدد"}
      </div>

      <div className="profile-power-premium">
        <div className="profile-power-icon">
          {(String(user?.gender || "") === "أنثى" ||
            String(user?.gender || "") === "بنت")
            ? "❤️"
            : "⚔️"}
        </div>

        <div className="profile-power-content">
          <div className="profile-power-title">
            {(String(user?.gender || "") === "أنثى" ||
              String(user?.gender || "") === "بنت")
              ? "الجاذبية"
              : "الثروة"}
          </div>

          <div className="profile-power-number">
            {(String(user?.gender || "") === "أنثى" ||
  String(user?.gender || "") === "بنت")
  ? Number(attraction || 0).toLocaleString("ar-SY")
  : Number(wealth || 0).toLocaleString("ar-SY")}
          </div>

          <div className="profile-power-caption">
            {(String(user?.gender || "") === "أنثى" ||
              String(user?.gender || "") === "بنت")
              ? `الجاذبية ❤️ • L.${attractionLevel}`
              : `الثروة ⚔️ • L.${wealthLevel}`}
          </div>
        </div>
      </div>

      <div className="profile-stats-grid">

        <div className="profile-stat">
          <span>🆔</span>
          <small>رقم العضوية</small>
          <strong>{user?.public_id || "—"}</strong>
        </div>

        <div className="profile-stat">
          <span>⚧</span>
          <small>الجنس</small>
          <strong>{user?.gender || "—"}</strong>
        </div>

        <div className="profile-stat">
          <span>🎂</span>
          <small>تاريخ الميلاد</small>
          <strong>{user?.birth_date || "—"}</strong>
        </div>

        <div className="profile-stat">
          <span>📅</span>
          <small>تاريخ التسجيل</small>
          <strong>
            {user?.created_at
              ? String(user.created_at).slice(0,10)
              : "—"}
          </strong>
        </div>

        <div className="profile-stat profile-likes-stat">
          <span>❤️</span>
          <small>الإعجابات</small>
          <strong>{Number(likesCount || 0).toLocaleString("ar-SY")}</strong>
        </div>

      </div>

      <div className="profile-locked">
        🔒 بيانات التسجيل الأساسية ثابتة ولا يمكن تغييرها.
      </div>

      <button
        className={
          "profile-verification-premium " +
          (verificationStatus === "approved"
            ? "is-approved"
            : verificationStatus === "pending"
            ? "is-pending"
            : "")
        }
        onClick={()=>{
          (async ()=>{
            try{

              if(!navigator.mediaDevices ||
                 !navigator.mediaDevices.getUserMedia){
                alert("الكاميرا تحتاج HTTPS");
                return;
              }

              if(
                verificationStatus==="pending" ||
                verificationStatus==="approved"
              ){
                return;
              }

              const stream =
                await navigator.mediaDevices.getUserMedia({
                  video:{ facingMode:"user" },
                  audio:true
                });

              const video=document.createElement("video");
              video.srcObject=stream;
              video.autoplay=true;

              Object.assign(video.style,{
                position:"fixed",
                top:"0",
                left:"0",
                width:"100%",
                height:"100%",
                zIndex:"9999",
                objectFit:"cover"
              });

              document.body.appendChild(video);

              const startBtn=document.createElement("button");
              startBtn.innerText="🎥 ابدأ تسجيل التوثيق";

              Object.assign(startBtn.style,{
                position:"fixed",
                bottom:"30px",
                left:"50%",
                transform:"translateX(-50%)",
                zIndex:"10001",
                padding:"15px 25px",
                borderRadius:"20px",
                border:"none",
                background:"#22d3ee",
                fontWeight:"bold"
              });

              document.body.appendChild(startBtn);

              startBtn.onclick=()=>{

                startBtn.remove();

                let chunks=[];
                const recorder=new MediaRecorder(stream);

                recorder.ondataavailable=e=>{
                  if(e.data.size>0) chunks.push(e.data);
                };

                recorder.onstop=async()=>{

                  const blob=new Blob(chunks,{
                    type:"video/webm"
                  });

                  const reader=new FileReader();

                  reader.onloadend=async()=>{


                    await fetch(
                      `${window.location.origin}/api/verification/request`,
                      {
                        method:"POST",
                        headers:{
                          "Content-Type":"application/json",
                        },
                        body:JSON.stringify({
                          video:reader.result
                        })
                      }
                    );

                    setVerificationStatus("pending");

                    alert(
                      "تم إرسال فيديو التوثيق للإدارة ✅"
                    );
                  };

                  reader.readAsDataURL(blob);

                  stream.getTracks().forEach(
                    t=>t.stop()
                  );

                  video.remove();
                };

                recorder.start();

                setTimeout(()=>{
                  recorder.stop();
                },15000);

                alert(
                  "🎥 بدأ التسجيل.. اعمل حركات الوجه"
                );
              };

              const guide=document.createElement("div");

              guide.innerText=
                "👀 انظر للكاميرا ثم حرّك رأسك يميناً ويساراً";

              Object.assign(guide.style,{
                position:"fixed",
                top:"30px",
                left:"50%",
                transform:"translateX(-50%)",
                zIndex:"10001",
                background:"#000",
                color:"#fff",
                padding:"15px",
                borderRadius:"15px",
                fontWeight:"bold",
                textAlign:"center"
              });

              document.body.appendChild(guide);

              setTimeout(()=>{
                guide.innerText="🙂 ابتسم ثم ارفع حاجبيك";
              },3000);

              setTimeout(()=>{
                guide.remove();
              },6000);

            }catch(e){
              alert("خطأ الكاميرا: "+e.message);
            }
          })();
        }}
      >
        {verificationStatus==="approved"
          ? "✓ الحساب موثق"
          : verificationStatus==="pending"
          ? "⏳ طلب التوثيق قيد المراجعة"
          : "📸 توثيق الحساب"}
      </button>

      
<div style={{
  textAlign:"center",
  marginTop:"18px",
  paddingBottom:"12px",
  fontSize:"11px",
  lineHeight:"1.8",
  color:"rgba(255,255,255,.45)"
}}>
          {/* REFERRAL_PAGE_BOX */}
          <button
            type="button"
            onClick={async () => {
              const page = document.createElement("div");

              Object.assign(page.style, {
                position:"fixed",
                inset:"0",
                zIndex:"100000",
                background:"#0e0816",
                color:"#fff",
                overflowY:"auto",
                direction:"rtl",
                padding:"20px",
                boxSizing:"border-box",
                fontFamily:"sans-serif"
              });

              page.innerHTML = `
                <div style="max-width:520px;margin:0 auto;padding:10px 4px 40px">
                  <h2 style="text-align:center;color:#facc15;margin-bottom:12px">
                    🎁 نظام الدعوات
                  </h2>

                  <p style="text-align:center;color:#bbb;line-height:1.8;margin-bottom:22px">
                    ادعُ أصدقاءك للتسجيل باستخدام كودك، وعند نجاح الدعوة تحصل على 100 نقطة.
                  </p>

                  <div style="padding:20px;border-radius:22px;background:linear-gradient(135deg,rgba(250,204,21,.16),rgba(255,255,255,.05));border:1px solid rgba(250,204,21,.25);text-align:center">
                    <div style="color:#aaa;font-size:13px;margin-bottom:8px">كود دعوتك</div>
                    <div id="myReferralCode" style="font-size:30px;font-weight:900;letter-spacing:3px;color:#facc15">
                      جاري التحميل...
                    </div>
                  </div>

                  <div style="display:flex;gap:10px;margin-top:14px">
                    <div style="flex:1;padding:16px;border-radius:18px;background:rgba(255,255,255,.06);text-align:center">
                      <div style="color:#aaa;font-size:12px">عدد الدعوات</div>
                      <div id="referralCount" style="font-size:24px;font-weight:900;margin-top:5px">0</div>
                    </div>

                    <div style="flex:1;padding:16px;border-radius:18px;background:rgba(255,255,255,.06);text-align:center">
                      <div style="color:#aaa;font-size:12px">النقاط المكتسبة</div>
                      <div id="referralPoints" style="font-size:24px;font-weight:900;margin-top:5px;color:#86efac">0</div>
                    </div>
                  </div>

                  <button id="shareReferral"
                    style="width:100%;margin-top:16px;padding:15px;border:0;border-radius:16px;background:#facc15;color:#111;font-weight:900;font-size:15px">
                    📤 مشاركة كود الدعوة
                  </button>

                  <button id="closeReferral"
                    style="width:100%;margin-top:12px;padding:14px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(255,255,255,.05);color:#fff;font-weight:900">
                    إغلاق
                  </button>

                  <div id="referralStatus" style="text-align:center;margin-top:18px;color:#aaa;font-size:13px"></div>
                </div>
              `;

              document.body.appendChild(page);

              const codeEl = page.querySelector("#myReferralCode");
              const countEl = page.querySelector("#referralCount");
              const pointsEl = page.querySelector("#referralPoints");
              const statusEl = page.querySelector("#referralStatus");

              let referralCode = "";

              try {

                const response = await fetch("/api/referrals/me", {
                });

                const data = await response.json();

                if (!response.ok || !data.success) {
                  throw new Error(data.message || "تعذر تحميل بيانات الدعوات");
                }

                referralCode = String(data.referral_code || "");

                codeEl.textContent = referralCode || "غير متوفر";
                countEl.textContent = Number(data.invited_count || 0);
                pointsEl.textContent = Number(data.earned_points || 0);
              } catch (err) {
                codeEl.textContent = "خطأ";
                statusEl.textContent = err.message || "تعذر تحميل بيانات الدعوات";
              }

              page.querySelector("#shareReferral").onclick = async () => {
                if (!referralCode) return;

                const text = "🎁 انضم إلى سوريانا باستخدام كود الدعوة: " + referralCode;

                try {
                  if (navigator.share) {
                    await navigator.share({ text });
                  } else if (navigator.clipboard) {
                    await navigator.clipboard.writeText(text);
                    statusEl.textContent = "✅ تم نسخ كود الدعوة";
                  } else {
                    statusEl.textContent = "كود الدعوة: " + referralCode;
                  }
                } catch (e) {}
              };

              page.querySelector("#closeReferral").onclick = () => page.remove();
            }}
            style={{
              width:"100%",
              marginTop:"10px",
              padding:"15px",
              borderRadius:"15px",
              border:"1px solid rgba(34,197,94,.25)",
              background:"linear-gradient(135deg,rgba(34,197,94,.14),rgba(255,255,255,.04))",
              color:"#86efac",
              fontWeight:"900",
              fontSize:"14px"
            }}
          >
            🎁 ادعُ أصدقاءك واربح 100 نقطة
          </button>
  © 2026 SURIANA ❤️💚<br/>
  حقوق النشر محفوظة — Jaafar.L المطوّر
</div>

<button
            type="button"
            onClick={() => {
              const page = document.createElement("div");
              page.innerHTML = `
                <div style="max-width:520px;margin:0 auto;padding:20px 4px 40px">
                  <h2 style="text-align:center;color:#facc15;margin-bottom:24px">📖 تعليمات استخدام سوريانا</h2>
                  <div style="padding:18px;border-radius:20px;background:rgba(255,255,255,.05);line-height:2;color:#eee">
                    <h3 style="color:#fde68a">💬 الدردشة</h3>
                    استخدم الدردشة للتواصل مع المستخدمين بطريقة محترمة وآمنة.<br><br>
                    <h3 style="color:#fde68a">📞 المكالمات</h3>
                    المكالمات الصوتية متاحة من داخل المحادثات وتُحتسب حسب نظام النقاط.<br><br>
                    <h3 style="color:#fde68a">💰 النقاط والمحفظة</h3>
                    يمكنك متابعة رصيدك وعمليات المحفظة من داخل التطبيق.<br><br>
                    <h3 style="color:#fde68a">🎁 دعوة الأصدقاء</h3>
                    استخدم رمز الدعوة الخاص بك لدعوة أصدقائك والحصول على المكافأة عند نجاح الإحالة.<br><br>
                    <h3 style="color:#fde68a">🛡️ الأمان</h3>
                    لا تشارك معلوماتك الشخصية أو بيانات حسابك مع الآخرين.
                  </div>
                  <button id="closeInstructionsPage"
                    style="width:100%;margin-top:24px;padding:14px;border:0;border-radius:15px;background:#facc15;color:#111;font-weight:900">
                    إغلاق
                  </button>
                </div>
              `;
              page.style.cssText="position:fixed;inset:0;background:#0e0816;color:#fff;z-index:99999;overflow:auto;direction:rtl";
              document.body.appendChild(page);
              page.querySelector("#closeInstructionsPage").onclick=()=>page.remove();
            }}
            style={{marginTop:"10px",padding:"15px",borderRadius:"15px",border:"1px solid rgba(250,204,21,.25)",background:"linear-gradient(135deg,rgba(250,204,21,.14),rgba(255,255,255,.04))",color:"#fde68a",fontWeight:"900",fontSize:"14px"}}
          >
            📖 تعليمات استخدام سوريانا
          </button>

          <button
  type="button"
  onClick={() => {
    const page = document.createElement("div");
    page.innerHTML = `
      <div style="max-width:520px;margin:0 auto;padding:20px 4px 40px">
        <h2 style="text-align:center;color:#facc15;margin-bottom:24px">
          🔐 سياسة الخصوصية وحقوق النشر
        </h2>
        <div style="padding:18px;border-radius:20px;background:rgba(255,255,255,.05);line-height:2;color:#eee">
          <h3 style="color:#fde68a">سياسة الخصوصية</h3>
          نحترم خصوصية جميع مستخدمي سوريانا، ولا نستخدم المعلومات الشخصية إلا لتشغيل التطبيق وتقديم خدماته وحماية الحسابات.<br><br>
          نستخدم بيانات الحساب لتشغيل التطبيق وتقديم خدماته.<br>
          لا يجوز مشاركة معلومات المستخدمين الخاصة أو استخدامها بطريقة تضر بهم.<br>
          يُمنع استخدام التطبيق لانتحال شخصية الآخرين أو نشر محتوى مخالف للقوانين.
          <h3 style="color:#fde68a;margin-top:24px">© حقوق النشر</h3>
          جميع حقوق تطبيق سوريانا والاسم والتصميم والواجهة والبرمجيات والمحتوى الأصلي محفوظة.<br><br>
          يُمنع نسخ أو إعادة نشر أو استغلال أي جزء من التطبيق دون إذن.<br><br>
          أي محتوى ينشره المستخدم يبقى مسؤولية صاحبه، ويجب أن يملك الحق في نشره.
        </div>
        <div style="text-align:center;margin-top:24px;color:#facc15;font-weight:900">
          © jaafar.L — جميع الحقوق محفوظة
        </div>
        <div style="text-align:center;margin-top:10px;font-weight:900">
          ❤️💚 SURIANA
        </div>
        <button id="closePrivacyPage"
          style="width:100%;margin-top:24px;padding:14px;border:0;border-radius:15px;background:#facc15;color:#111;font-weight:900">
          إغلاق
        </button>
      </div>
    `;

    Object.assign(page.style,{
      position:"fixed",
      inset:"0",
      zIndex:"99999",
      background:"#0e0816",
      color:"#fff",
      overflowY:"auto",
      direction:"rtl",
      padding:"20px",
      boxSizing:"border-box",
      fontFamily:"sans-serif"
    });

    document.body.appendChild(page);
    page.querySelector("#closePrivacyPage").onclick=()=>page.remove();
  }}
  style={{
    width:"100%",
    marginTop:"10px",
    padding:"14px",
    borderRadius:"15px",
    border:"1px solid rgba(250,204,21,.25)",
    background:"linear-gradient(135deg,rgba(250,204,21,.12),rgba(255,255,255,.04))",
    color:"#fde68a",
    fontWeight:"900",
    fontSize:"14px"
  }}
>
  🔐 سياسة الخصوصية وحقوق النشر
</button>

<button
        onClick={handleLogout}
        className="profile-logout-premium"
      >
        تسجيل الخروج
      </button>

    </div>

  </div>
)}
          <div style={{ position: 'fixed', bottom: '0', left: '0', right: '0', height: '72px', background: '#110a1c', display: 'flex', justifyContent: 'space-around', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', zIndex: 1000 }}>
            <button onClick={() => setTab("discover")} style={{ background: 'transparent', border: 'none', color: tab === "discover" ? '#ff6b8b' : '#6b7280', display:'flex', flexDirection:'column', alignItems:'center' }}><span>🔥</span><span style={{fontSize:'11px'}}>اكتشف</span></button>
              <button onClick={() => {setTab("users"); loadUsers();}} style={{ background: 'transparent', border: 'none', color: tab === "users" ? '#ff6b8b' : '#6b7280', display:'flex', flexDirection:'column', alignItems:'center' }}><span>👥</span><span style={{fontSize:'11px'}}>المستخدمين</span></button>
            <button onClick={() => setTab("chat")} style={{ background: 'transparent', border: 'none', color: tab === "chat" ? '#ff6b8b' : '#6b7280', display:'flex', flexDirection:'column', alignItems:'center' }}><span>💬</span><span style={{fontSize:'11px'}}>الدردشات</span></button>
            {isAdmin && <button onClick={()=>setTab("admin_panel")} style={{background:"transparent",border:"none",color:"#22c55e",display:"flex",flexDirection:"column",alignItems:"center"}}><span>👑</span><span style={{fontSize:"11px"}}>إدارة</span></button>}
            <button onClick={() => setTab("wallet")} style={{ background: 'transparent', border: 'none', color: tab === "wallet" ? '#ff6b8b' : '#6b7280', display:'flex', flexDirection:'column', alignItems:'center' }}><span>💰</span><span style={{fontSize:'11px'}}>المحفظة</span></button>
            <button onClick={() => setTab("profile")} style={{ background: 'transparent', border: 'none', color: tab === "profile" ? '#ff6b8b' : '#6b7280', display:'flex', flexDirection:'column', alignItems:'center' }}><span>👤</span><span style={{fontSize:'11px'}}>حسابي</span></button>
          </div>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App />);




function AdminSecurity(){
  const [sessions,setSessions]=useState([]);
  const [loading,setLoading]=useState(true);

  const loadSessions=async()=>{
    try{
      setLoading(true);
      const res=await fetch(`${window.location.origin}/api/admin/security/sessions`,{
      });
      const data=await res.json();

      if(data.success){
        setSessions(data.sessions || []);
      }else{
        alert(data.message || "فشل تحميل جلسات الأمان");
      }
    }catch(e){
      alert("خطأ في الاتصال");
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{
    loadSessions();
  },[]);

  const revokeSession=async(id)=>{
    if(!window.confirm("هل تريد طرد هذه الجلسة؟")) return;

    try{
      const res=await fetch(
        `${window.location.origin}/api/admin/security/sessions/${id}/revoke`,
        {
          method:"POST"
        }
      );

      const data=await res.json();

      if(data.success){
        alert("🚫 تم طرد الجلسة");
        loadSessions();
      }else{
        alert(data.message || "فشل طرد الجلسة");
      }
    }catch(e){
      alert("خطأ في الاتصال");
    }
  };

  const toggleBan=async(session)=>{
    const action=session.is_banned ? "unban" : "ban";
    const text=session.is_banned
      ? "هل تريد فك حظر هذا الحساب؟"
      : "هل تريد حظر هذا الحساب وإنهاء جلساته؟";

    if(!window.confirm(text)) return;

    try{
      const res=await fetch(
        `${window.location.origin}/api/admin/security/users/${session.user_id}/${action}`,
        {
          method:"POST"
        }
      );

      const data=await res.json();

      if(data.success){
        alert(data.message || "تم تنفيذ العملية");
        loadSessions();
      }else{
        alert(data.message || "فشل تنفيذ العملية");
      }
    }catch(e){
      alert("خطأ في الاتصال");
    }
  };

  return(
    <div style={{
      background:"#111827",
      padding:"16px",
      borderRadius:"16px",
      marginTop:"12px"
    }}>
      <h4 style={{color:"#f87171",marginBottom:"12px"}}>
        ⚠️ أمان لوحة الإدارة
      </h4>

      <div style={{
        background:"#1f2937",
        padding:"12px",
        borderRadius:"12px",
        marginBottom:"14px",
        color:"#fca5a5"
      }}>
        🔐 كل جلسة للمالك أو المشرف يتم تسجيلها هنا ويمكن إنهاؤها من السيرفر.
      </div>

      {loading ? (
        <div>جاري تحميل الجلسات...</div>
      ) : sessions.length === 0 ? (
        <div style={{color:"#9ca3af"}}>
          لا توجد جلسات إدارية مسجلة.
        </div>
      ) : (
        sessions.map(s=>(
          <div key={s.id} style={{
            background:"#0f172a",
            border:"1px solid #374151",
            borderRadius:"14px",
            padding:"12px",
            marginBottom:"10px"
          }}>
            <div style={{fontWeight:"700",color:"#fff"}}>
              {s.role==="owner" ? "👑 المالك" : "👮 المشرف"} — {s.name}
            </div>

            <div style={{fontSize:"13px",color:"#d1d5db",marginTop:"6px"}}>
              🆔 ID: {s.user_id}
            </div>

            <div style={{fontSize:"13px",color:"#d1d5db"}}>
              📧 {s.email}
            </div>

            <div style={{fontSize:"13px",color:"#d1d5db"}}>
              🌐 IP: {s.ip || "غير معروف"}
            </div>

            <div style={{
              fontSize:"12px",
              color:"#9ca3af",
              marginTop:"6px",
              wordBreak:"break-word"
            }}>
              📱 {s.user_agent || "غير معروف"}
            </div>

            <div style={{fontSize:"12px",color:"#9ca3af",marginTop:"6px"}}>
              🕐 الدخول: {s.created_at}
            </div>

            <div style={{fontSize:"12px",color:"#9ca3af"}}>
              👀 آخر نشاط: {s.last_seen}
            </div>

            <div style={{marginTop:"10px",display:"flex",gap:"8px",flexWrap:"wrap"}}>
              {!s.revoked_at && s.role !== "owner" && (
                <button
                  onClick={()=>revokeSession(s.id)}
                  style={{
                    background:"#dc2626",
                    color:"#fff",
                    border:"0",
                    borderRadius:"10px",
                    padding:"8px 12px"
                  }}
                >
                  🚫 طرد الجلسة
                </button>
              )}

              {s.role !== "owner" && (
                <button
                  onClick={()=>toggleBan(s)}
                  style={{
                    background:s.is_banned ? "#16a34a" : "#b91c1c",
                    color:"#fff",
                    border:"0",
                    borderRadius:"10px",
                    padding:"8px 12px"
                  }}
                >
                  {s.is_banned ? "🔓 فك الحظر" : "⛔ حظر الحساب"}
                </button>
              )}
            </div>

            {s.revoked_at && (
              <div style={{color:"#f87171",fontSize:"12px",marginTop:"8px"}}>
                🚫 الجلسة منتهية
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function AdminModerators(){
  const [moderators,setModerators]=useState([]);
  const [userId,setUserId]=useState("");
  const [loading,setLoading]=useState(true);
  const [adding,setAdding]=useState(false);

  const loadModerators=async()=>{
    try{
      setLoading(true);
      const res=await fetch(`${window.location.origin}/api/admin/moderators`,{
      });
      const data=await res.json();

      if(data.success){
        setModerators(data.moderators || []);
      }else{
        alert(data.message || "فشل تحميل المشرفين");
      }
    }catch(e){
      alert("خطأ في الاتصال");
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{
    loadModerators();
  },[]);

  const addModerator=async()=>{
    const id=Number(userId);

    if(!Number.isInteger(id) || id<=0){
      alert("أدخل ID صحيح");
      return;
    }

    if(!window.confirm(`هل تريد إضافة المستخدم ID ${id} كمشرف؟`)) return;

    try{
      setAdding(true);

      const res=await fetch(
        `${window.location.origin}/api/admin/moderators/${id}/add`,
        {
          method:"POST"
        }
      );

      const data=await res.json();

      if(data.success){
        alert("👮 تمت إضافة المشرف");
        setUserId("");
        loadModerators();
      }else{
        alert(data.message || "فشل إضافة المشرف");
      }
    }catch(e){
      alert("خطأ في الاتصال");
    }finally{
      setAdding(false);
    }
  };

  const removeModerator=async(id)=>{
    if(!window.confirm("هل تريد إزالة صلاحية المشرف وإنهاء جلساته؟")) return;

    try{
      const res=await fetch(
        `${window.location.origin}/api/admin/moderators/${id}/remove`,
        {
          method:"POST"
        }
      );

      const data=await res.json();

      if(data.success){
        alert("✅ تمت إزالة صلاحية المشرف");
        loadModerators();
      }else{
        alert(data.message || "فشل إزالة المشرف");
      }
    }catch(e){
      alert("خطأ في الاتصال");
    }
  };

  return(
    <div style={{
      background:"#111827",
      padding:"16px",
      borderRadius:"16px",
      marginTop:"12px"
    }}>
      <h4 style={{color:"#a78bfa",marginBottom:"12px"}}>
        👮 إدارة المشرفين
      </h4>

      <div style={{
        background:"#1f2937",
        padding:"12px",
        borderRadius:"12px",
        marginBottom:"14px"
      }}>
        <div style={{color:"#d1d5db",marginBottom:"8px"}}>
          أضف مستخدماً موجوداً كمشرف عن طريق الـID:
        </div>

        <div style={{display:"flex",gap:"8px"}}>
          <input
            value={userId}
            onChange={e=>setUserId(e.target.value)}
            placeholder="ID المستخدم"
            inputMode="numeric"
            style={{
              flex:1,
              padding:"10px",
              borderRadius:"10px",
              border:"1px solid #374151",
              background:"#0f172a",
              color:"#fff"
            }}
          />

          <button
            onClick={addModerator}
            disabled={adding}
            style={{
              background:"#7c3aed",
              color:"#fff",
              border:"0",
              borderRadius:"10px",
              padding:"10px 14px"
            }}
          >
            {adding ? "جاري..." : "➕ إضافة"}
          </button>
        </div>
      </div>

      {loading ? (
        <div>جاري تحميل المشرفين...</div>
      ) : moderators.length === 0 ? (
        <div style={{color:"#9ca3af"}}>
          لا يوجد مشرفون حالياً.
        </div>
      ) : (
        moderators.map(m=>(
          <div key={m.id} style={{
            background:"#0f172a",
            border:"1px solid #374151",
            borderRadius:"14px",
            padding:"12px",
            marginBottom:"10px"
          }}>
            <div style={{fontWeight:"700",color:"#fff"}}>
              👮 {m.name}
            </div>

            <div style={{fontSize:"13px",color:"#d1d5db"}}>
              🆔 ID: {m.id}
            </div>

            <div style={{fontSize:"13px",color:"#d1d5db"}}>
              📧 {m.email}
            </div>

            <div style={{
              fontSize:"13px",
              color:m.is_banned ? "#f87171" : "#4ade80",
              marginTop:"6px"
            }}>
              {m.is_banned ? "⛔ محظور" : "🟢 فعال"}
            </div>

            <button
              onClick={()=>removeModerator(m.id)}
              style={{
                marginTop:"10px",
                background:"#dc2626",
                color:"#fff",
                border:"0",
                borderRadius:"10px",
                padding:"8px 12px"
              }}
            >
              🗑 إزالة المشرف
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function AdminSettings(){
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");

  const saveSettings=async()=>{
    try{

      const res=await fetch(`${window.location.origin}/api/admin/settings`,{
        method:"PUT",
        headers:{
          "Content-Type":"application/json",
        },
        body:JSON.stringify({email,password})
      });

      const data=await res.json();

      if(data.success){
        alert("✅ تم تحديث إعدادات الإدارة");
        setPassword("");
      }else{
        alert(data.message || "فشل التحديث");
      }

    }catch(e){
      alert("خطأ في الاتصال");
    }
  };

  return (
    <div style={{padding:"15px",background:"rgba(255,255,255,0.05)",borderRadius:"15px"}}>
      <h4 style={{color:"#60a5fa"}}>⚙️ إعدادات الإدارة</h4>

      <input
        placeholder="الإيميل الجديد"
        value={email}
        onChange={e=>setEmail(e.target.value)}
        style={{width:"100%",padding:"10px",margin:"8px 0",borderRadius:"10px"}}
      />

      <input
        type="password"
        placeholder="كلمة السر الجديدة"
        value={password}
        onChange={e=>setPassword(e.target.value)}
        style={{width:"100%",padding:"10px",margin:"8px 0",borderRadius:"10px"}}
      />

      <button
        onClick={saveSettings}
        style={{width:"100%",padding:"12px",borderRadius:"10px",background:"#60a5fa",border:"none"}}
      >
        💾 حفظ التغييرات
      </button>
    </div>
  );
}




function AdminStats(){
  const [stats,setStats]=useState(null);

  useEffect(()=>{
    const load=async()=>{
      const res=await fetch(`${window.location.origin}/api/admin/stats`,{
      });
      const data=await res.json();
      if(data.success) setStats(data.stats);
    };
    load();
  },[]);

  if(!stats) return <div>جاري التحميل...</div>;

  return(
    <div style={{padding:"15px",background:"rgba(255,255,255,0.05)",borderRadius:"15px"}}>
      <h4 style={{color:"#22c55e"}}>📊 لوحة إحصائيات سوريانا</h4>

      <div>👥 المستخدمين: {stats.users}</div>
      <div>✅ الموثقين: {stats.verified}</div>
      <div>💬 الرسائل: {stats.messages}</div>

      <hr/>

      <div>💳 طلبات الشحن: {stats.charges}</div>
      <div>💵 قيمة الشحن: {stats.charge_money} ل.س</div>

      <div>📥 طلبات السحب: {stats.withdraws}</div>
      <div>📤 نقاط السحب: {stats.withdraw_points}</div>

      <hr/>

      <div>⭐ نقاط المستخدمين: {stats.points}</div>
      <div style={{color:"#fbbf24",fontWeight:"bold"}}>
        💰 أرباح سوريانا: {stats.profits} نقطة
      </div>
    </div>
  );
}

function AdminMoney(){
  const [settings,setSettings]=useState({sham_cash:"",syriatel_cash:"",mtn_cash:"",point_price:0});
  const [stats,setStats]=useState(null);
    const [charges,setCharges]=useState([]);
    const [adminDirectChargeUserId,setAdminDirectChargeUserId]=useState("");
    const [adminDirectChargePoints,setAdminDirectChargePoints]=useState("");
    const [adminDirectChargeLoading,setAdminDirectChargeLoading]=useState(false);
    const [adminDirectWithdrawUserId,setAdminDirectWithdrawUserId]=useState("");
    const [adminDirectWithdrawUser,setAdminDirectWithdrawUser]=useState(null);
    const [adminDirectWithdrawPoints,setAdminDirectWithdrawPoints]=useState("");
    const [adminDirectWithdrawLoading,setAdminDirectWithdrawLoading]=useState(false);
    const [adminDirectWithdrawLookupLoading,setAdminDirectWithdrawLookupLoading]=useState(false);

  useEffect(()=>{

    fetch(`${window.location.origin}/api/admin/payment-settings`,{
    })
    .then(r=>r.json())
    .then(data=>{
      if(data.success && data.settings) setSettings(data.settings);
    });

    fetch(`${window.location.origin}/api/admin/stats`,{
    })
    .then(r=>r.json())
    .then(data=>{
      if(data.success) setStats(data.stats);
    });
      fetch(`${window.location.origin}/api/admin/charges`,{}).then(r=>r.json()).then(data=>{if(data.success)setCharges(data.requests||[]);});

  },[]);

  const adminDirectCharge=async()=>{
      const userId=Number(adminDirectChargeUserId);
      const points=Number(adminDirectChargePoints);

      if(!Number.isInteger(userId) || userId<=0){
        return alert("❌ أدخل ID مستخدم صحيح");
      }

      if(!Number.isInteger(points) || points<=0){
        return alert("❌ أدخل عدد نقاط صحيح وموجب");
      }

      if(!window.confirm(`تأكيد شحن ${points} نقطة للمستخدم ID ${userId}؟`)){
        return;
      }

      setAdminDirectChargeLoading(true);

      try{

        const res=await fetch(
          `${window.location.origin}/api/admin/wallet/charge`,
          {
            method:"POST",
            headers:{
              "Content-Type":"application/json",
            },
            body:JSON.stringify({
              user_id:userId,
              points:points
            })
          }
        );

        const data=await res.json();

        if(data.success){
          alert(
            `✅ تم الشحن بنجاح\n\n` +
            `المستخدم: ${data.user?.name || "-"}\n` +
            `ID: ${data.user?.id || userId}\n` +
            `النقاط المضافة: ${data.charged_points || points}\n` +
            `الرصيد الجديد: ${data.user?.points ?? "-"}`
          );

          setAdminDirectChargeUserId("");
          setAdminDirectChargePoints("");
        }else{
          alert("❌ " + (data.message || "تعذر تنفيذ الشحن"));
        }
      }catch(err){
        console.error("ADMIN DIRECT CHARGE ERROR:",err);
        alert("❌ حدث خطأ أثناء شحن المستخدم");
      }finally{
        setAdminDirectChargeLoading(false);
      }
    };

    const lookupAdminDirectWithdrawUser=async()=>{
      const userId=Number(adminDirectWithdrawUserId);

      if(!Number.isInteger(userId) || userId<=0){
        setAdminDirectWithdrawUser(null);
        return alert("❌ أدخل ID مستخدم صحيح");
      }

      setAdminDirectWithdrawLookupLoading(true);

      try{

        const res=await fetch(
          `${window.location.origin}/api/admin/users/${userId}`,
          {
          }
        );

        const data=await res.json();

        if(data.success && data.user){
          setAdminDirectWithdrawUser(data.user);
          setAdminDirectWithdrawPoints("");
        }else{
          setAdminDirectWithdrawUser(null);
          alert("❌ " + (data.message || "المستخدم غير موجود"));
        }
      }catch(err){
        console.error("ADMIN WITHDRAW USER LOOKUP ERROR:",err);
        setAdminDirectWithdrawUser(null);
        alert("❌ تعذر جلب بيانات المستخدم");
      }finally{
        setAdminDirectWithdrawLookupLoading(false);
      }
    };

    const adminDirectWithdraw=async()=>{
      if(adminDirectWithdrawLoading) return;

      const userId=Number(adminDirectWithdrawUserId);
      const points=Number(adminDirectWithdrawPoints);

      if(!Number.isInteger(userId) || userId<=0){
        return alert("❌ أدخل ID مستخدم صحيح");
      }

      if(!Number.isInteger(points) || points<=0){
        return alert("❌ أدخل عدد نقاط صحيح وموجب");
      }

      if(!adminDirectWithdrawUser){
        return alert("❌ ابحث عن المستخدم أولاً");
      }

      const currentPoints=Number(adminDirectWithdrawUser.points || 0);

      if(currentPoints < points){
        return alert(
          `❌ رصيد المستخدم غير كافي\n\n` +
          `الرصيد الحالي: ${currentPoints.toLocaleString("ar-SY")} نقطة\n` +
          `المطلوب سحبه: ${points.toLocaleString("ar-SY")} نقطة`
        );
      }

      if(!window.confirm(
        `تأكيد سحب ${points.toLocaleString("ar-SY")} نقطة؟\n\n` +
        `المستخدم: ${adminDirectWithdrawUser.name || "-"}\n` +
        `ID: ${userId}\n` +
        `الرصيد الحالي: ${currentPoints.toLocaleString("ar-SY")} نقطة`
      )){
        return;
      }

      setAdminDirectWithdrawLoading(true);

      try{

        const res=await fetch(
          `${window.location.origin}/api/admin/wallet/withdraw`,
          {
            method:"POST",
            headers:{
              "Content-Type":"application/json",
            },
            body:JSON.stringify({
              user_id:userId,
              points:points
            })
          }
        );

        const data=await res.json();

        if(data.success){
          alert(
            `✅ تم سحب النقاط بنجاح\n\n` +
            `المستخدم: ${data.user?.name || adminDirectWithdrawUser.name || "-"}\n` +
            `ID: ${data.user?.id || userId}\n` +
            `النقاط المسحوبة: ${data.withdrawn_points || points}\n` +
            `الرصيد الجديد: ${data.user?.points ?? "-"}`
          );

          if(data.user){
            setAdminDirectWithdrawUser(data.user);
          }

          setAdminDirectWithdrawPoints("");
        }else{
          alert("❌ " + (data.message || "تعذر تنفيذ السحب"));
        }
      }catch(err){
        console.error("ADMIN DIRECT WITHDRAW ERROR:",err);
        alert("❌ حدث خطأ أثناء سحب نقاط المستخدم");
      }finally{
        setAdminDirectWithdrawLoading(false);
      }
    };

    const save=async()=>{

    await fetch(`${window.location.origin}/api/admin/payment-settings`,{
      method:"PUT",
      headers:{
        "Content-Type":"application/json",
      },
      body:JSON.stringify(settings)
    });

    alert("✅ تم حفظ إعدادات المال");
  };

  return(
    <div style={{padding:"15px",background:"rgba(255,255,255,0.05)",borderRadius:"15px"}}>

      <h4 style={{color:"#eab308"}}>💰 إدارة المال</h4>
        <div style={{
          margin:"14px 0",
          padding:"16px",
          background:"linear-gradient(135deg,rgba(124,58,237,.18),rgba(236,72,153,.12))",
          border:"1px solid rgba(167,139,250,.25)",
          borderRadius:"16px"
        }}>
          <div style={{
            fontWeight:"900",
            fontSize:"16px",
            marginBottom:"5px"
          }}>
            ⭐ شحن مباشر لمستخدم
          </div>

          <div style={{
            fontSize:"12px",
            color:"#9ca3af",
            marginBottom:"12px"
          }}>
            أضف نقاط للمستخدم مباشرة عن طريق رقم الـID.
          </div>

          <input
            type="number"
            min="1"
            placeholder="🆔 ID المستخدم"
            value={adminDirectChargeUserId}
            onChange={e=>setAdminDirectChargeUserId(e.target.value)}
            style={{marginBottom:"8px"}}
          />

          <input
            type="number"
            min="1"
            placeholder="⭐ عدد النقاط"
            value={adminDirectChargePoints}
            onChange={e=>setAdminDirectChargePoints(e.target.value)}
            style={{marginBottom:"10px"}}
          />

          <button
            type="button"
            onClick={adminDirectCharge}
            disabled={adminDirectChargeLoading}
            style={{
              width:"100%",
              background:"#7c3aed",
              color:"#fff",
              border:"none",
              padding:"11px",
              borderRadius:"10px",
              fontWeight:"900",
              cursor:adminDirectChargeLoading ? "wait" : "pointer",
              opacity:adminDirectChargeLoading ? 0.7 : 1
            }}
          >
            {adminDirectChargeLoading ? "⏳ جاري الشحن..." : "⭐ شحن المستخدم"}
          </button>
        </div>



      <div style={{
        margin:"14px 0",
        padding:"16px",
        background:"linear-gradient(135deg,rgba(239,68,68,.16),rgba(245,158,11,.10))",
        border:"1px solid rgba(248,113,113,.25)",
        borderRadius:"16px"
      }}>
        <div style={{
          fontWeight:"900",
          fontSize:"16px",
          marginBottom:"5px"
        }}>
          💸 سحب مباشر من مستخدم
        </div>

        <div style={{
          fontSize:"12px",
          color:"#9ca3af",
          marginBottom:"12px"
        }}>
          أدخل ID المستخدم لمعرفة اسمه ورصيده ثم اسحب النقاط مباشرة.
        </div>

        <div style={{
          display:"flex",
          gap:"8px",
          marginBottom:"10px"
        }}>
          <input
            type="number"
            min="1"
            placeholder="🆔 ID المستخدم"
            value={adminDirectWithdrawUserId}
            onChange={e=>{
              setAdminDirectWithdrawUserId(e.target.value);
              setAdminDirectWithdrawUser(null);
            }}
            style={{marginBottom:0,flex:1}}
          />

          <button
            type="button"
            onClick={lookupAdminDirectWithdrawUser}
            disabled={adminDirectWithdrawLookupLoading}
            style={{
              padding:"10px 14px",
              borderRadius:"10px",
              border:"none",
              background:"#f59e0b",
              color:"#111827",
              fontWeight:"900",
              cursor:"pointer",
              opacity:adminDirectWithdrawLookupLoading ? 0.7 : 1
            }}
          >
            {adminDirectWithdrawLookupLoading ? "⏳" : "🔎 بحث"}
          </button>
        </div>

        {adminDirectWithdrawUser && (
          <div style={{
            padding:"12px",
            marginBottom:"10px",
            borderRadius:"12px",
            background:"rgba(0,0,0,.25)",
            border:"1px solid rgba(255,255,255,.08)"
          }}>
            <div style={{fontWeight:"900"}}>
              👤 {adminDirectWithdrawUser.name || "-"}
            </div>

            <div style={{
              fontSize:"13px",
              color:"#d1d5db",
              marginTop:"5px"
            }}>
              🆔 ID: {adminDirectWithdrawUser.id}
            </div>

            <div style={{
              fontSize:"15px",
              fontWeight:"900",
              marginTop:"6px"
            }}>
              ⭐ الرصيد الحالي:{" "}
              {Number(adminDirectWithdrawUser.points || 0).toLocaleString("ar-SY")} نقطة
            </div>
          </div>
        )}

        <input
          type="number"
          min="1"
          placeholder="⭐ عدد النقاط المراد سحبها"
          value={adminDirectWithdrawPoints}
          onChange={e=>setAdminDirectWithdrawPoints(e.target.value)}
          style={{marginBottom:"10px"}}
        />

        <button
          type="button"
          onClick={adminDirectWithdraw}
          disabled={
            adminDirectWithdrawLoading ||
            !adminDirectWithdrawUser
          }
          style={{
            width:"100%",
            background:"#dc2626",
            color:"#fff",
            border:"none",
            padding:"11px",
            borderRadius:"10px",
            fontWeight:"900",
            cursor:adminDirectWithdrawLoading ? "wait" : "pointer",
            opacity:
              adminDirectWithdrawLoading || !adminDirectWithdrawUser
                ? 0.55
                : 1
          }}
        >
          {adminDirectWithdrawLoading
            ? "⏳ جاري السحب..."
            : "💸 سحب النقاط من المستخدم"}
        </button>
      </div>

      {stats &&
      <div style={{marginBottom:"15px"}}>
        <div>💰 أرباح سوريانا: {stats.profits} نقطة</div>
        <div>💵 قيمة الشحن: {stats.charge_money} ل.س</div>
        <div>📥 طلبات الشحن: {stats.charges}</div>
        <div>📤 طلبات السحب: {stats.withdraws}</div>
      </div>
        }


        <input placeholder="شام كاش"
         value={settings.sham_cash}
         onChange={e=>setSettings({...settings,sham_cash:e.target.value})}/>

        <input placeholder="سيريتل كاش"
         value={settings.syriatel_cash}
         onChange={e=>setSettings({...settings,syriatel_cash:e.target.value})}/>
      <input placeholder="MTN"
       value={settings.mtn_cash}
       onChange={e=>setSettings({...settings,mtn_cash:e.target.value})}/>

      <input placeholder="سعر النقطة"
       value={settings.point_price}
       onChange={e=>setSettings({...settings,point_price:e.target.value})}/>

        <h5>📥 طلبات الشحن</h5>
          {charges.map(c=>(
              <div key={c.id} style={{padding:"10px",background:"#222",margin:"8px",borderRadius:"10px"}}>
                💳 {c.name} - {c.points} نقطة
                <br/>
                💵 الطريقة: {c.method || "-"}
                <br/>
                📱 الرقم: {c.phone || "-"}
                <br/>
                🧾 الإيصال: {c.receipt ? (
  <a
    href={`/api/admin/charges/${c.id}/receipt`}
    target="_blank"
    rel="noopener noreferrer"
    style={{
      color:"#ff6b8b",
      textDecoration:"underline",
      cursor:"pointer"
    }}
  >
    👁️ عرض الإيصال
  </a>
) : "لا يوجد"}
                <br/>
                الحالة: {c.status}
                <br/>

                {c.status === "pending" ? (
                <>
                  <button style={{margin:"5px"}} onClick={async()=>{
                    await fetch(`${window.location.origin}/api/admin/charge/approve/${c.id}`,{
                      method:"POST"
                    });
                   window.location.reload();
                  }}>
                  ✅ قبول
                  </button>

                  <button style={{margin:"5px"}} onClick={async()=>{
                    await fetch(`${window.location.origin}/api/admin/charge/reject/${c.id}`,{
                      method:"POST"
                    });
                    window.location.reload();
                  }}>
                  ❌ رفض
                  </button>
                </>
                ) : (
                  <b>{c.status==="approved" ? "تم القبول ✅" : "مرفوض ❌"}</b>
                )}
              </div>
            ))}
      <button onClick={save}>💾 حفظ</button>

    </div>
  );
}

function AdminControl(){
  const [settings,setSettings]=useState({maintenance:0,register_open:1,announcement:"",message_cost:0});

  useEffect(()=>{
    const load=async()=>{
      const res=await fetch(`${window.location.origin}/api/admin/app-settings`,{
      });
      const data=await res.json();
      if(data.success && data.settings) setSettings(data.settings);
    };
    load();
  },[]);

  const save=async()=>{
    await fetch(`${window.location.origin}/api/admin/app-settings`,{
      method:"PUT",
      headers:{
        "Content-Type":"application/json",
      },
      body:JSON.stringify(settings)
    });
    alert("✅ تم حفظ التحكم العام");
  };

  return <div style={{padding:"15px",background:"rgba(255,255,255,0.05)",borderRadius:"15px"}}>
    <h4 style={{color:"#8b5cf6"}}>⚙️ التحكم العام</h4>

    <button onClick={()=>setSettings({...settings,maintenance:settings.maintenance?0:1})}>
      {settings.maintenance?"🔴 إيقاف الصيانة":"🟢 تشغيل الصيانة"}
    </button>

    <button onClick={()=>setSettings({...settings,register_open:settings.register_open?0:1})}>
      {settings.register_open?"🔓 التسجيل مفتوح":"🔒 التسجيل مغلق"}
    </button>

    <input placeholder="الرسالة العامة" value={settings.announcement} onChange={e=>setSettings({...settings,announcement:e.target.value})}/>
    <input placeholder="تكلفة الرسالة" value={settings.message_cost} onChange={e=>setSettings({...settings,message_cost:e.target.value})}/>

    <button onClick={save}>💾 حفظ</button>
  </div>;
}

function AdminUsers(){
  const [users,setUsers]=useState([]);
  const [searchText,setSearchText]=useState("");

  const loadUsers=async()=>{
    try{

      const res=await fetch(`${window.location.origin}/api/admin/users`,{
      });

      const data=await res.json();

      if(data.success){
        setUsers(data.users);
      }
    }catch(e){
      console.error(e);
    }
  };

  useEffect(()=>{
    loadUsers();
  },[]);

  const filteredUsers=users.filter(u=>{
    const q=searchText.trim().toLowerCase();

    if(!q) return true;

    return String(u.id).includes(q) ||
      String(u.name || "").toLowerCase().includes(q) ||
      String(u.email || "").toLowerCase().includes(q);
  });

  const toggleBan=async(user)=>{

    await fetch(
      `${window.location.origin}/api/admin/users/${user.is_banned?'unban':'ban'}/${user.id}`,
      {
        method:"POST"
      }
    );

    loadUsers();
  };

  return(
    <div>
      <h4 style={{color:"#fbbf24"}}>
        👥 إدارة المشتركين والحظر ({users.length})
      </h4>

      <input
        type="text"
        placeholder="🔎 بحث بالـID أو الاسم أو الإيميل"
        value={searchText}
        onChange={e=>setSearchText(e.target.value)}
        style={{marginBottom:"12px"}}
      />

      <div style={{
        fontSize:"12px",
        color:"#9ca3af",
        marginBottom:"10px"
      }}>
        عرض {filteredUsers.length} من {users.length} مستخدم
      </div>

      {filteredUsers.map(u=>(
        <div
          key={u.id}
          style={{
            padding:"12px",
            background:"rgba(255,255,255,0.05)",
            borderRadius:"12px",
            marginBottom:"8px"
          }}
        >
          {u.role !== "admin" && (
            <button
              onClick={()=>toggleBan(u)}
              style={{
                background:u.is_banned?"#10b981":"#ef4444",
                color:"#fff",
                border:"none",
                borderRadius:"8px",
                padding:"6px 12px",
                float:"left"
              }}
            >
              {u.is_banned?"رفع الحظر":"حظر"}
            </button>
          )}

          <div style={{marginRight:"10px"}}>
            <div style={{fontWeight:"900"}}>
              {u.name || "بدون اسم"}
            </div>

            <div style={{
              fontSize:"11px",
              color:"#9ca3af",
              marginTop:"3px"
            }}>
              🆔 {u.id} · {u.email || "بدون إيميل"}
            </div>

            <div style={{
              fontSize:"12px",
              marginTop:"5px"
            }}>
              ⭐ {Number(u.points || 0).toLocaleString("ar-SY")} نقطة
              {" · "}
              {u.is_verified ? "📸 موثق" : "⚪ غير موثق"}
              {" · "}
              {u.is_banned ? "🔴 محظور" : "🟢 فعال"}
            </div>

            <div style={{
              fontSize:"11px",
              color:"#9ca3af",
              marginTop:"3px"
            }}>
              📍 {u.city || "-"} · {u.gender || "-"} · 🎂 {u.age ?? "-"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminVerification(){
  const [requests,setRequests]=useState([]);

  const loadRequests=async()=>{

    const res=await fetch(`${window.location.origin}/api/admin/verification`,{
    });

    const data=await res.json();

    if(data.success){
      setRequests(data.requests);
    }
  };

  useEffect(()=>{
    loadRequests();
  },[]);

  const action=async(id,type)=>{
    try{

      const res=await fetch(
        `${window.location.origin}/api/admin/verification/${type}/${id}`,
        {
          method:"POST"
        }
      );

      const data=await res.json();

      if(!data.success){
        return alert("❌ " + (data.message || "تعذر تنفيذ العملية"));
      }

      alert(
        type==="approve"
          ? "✅ تم قبول التوثيق"
          : "❌ تم رفض التوثيق"
      );

      loadRequests();
    }catch(e){
      console.error("VERIFICATION ACTION ERROR:",e);
      alert("❌ حدث خطأ أثناء تنفيذ العملية");
    }
  };

  const deleteRequest=async(id)=>{
    if(!window.confirm("هل تريد حذف طلب التوثيق نهائياً؟")) return;

    try{

      const res=await fetch(
        `${window.location.origin}/api/admin/verification/delete/${id}`,
        {
          method:"POST"
        }
      );

      const data=await res.json();

      if(!data.success){
        return alert("❌ " + (data.message || "تعذر حذف الطلب"));
      }

      alert("🗑 تم حذف طلب التوثيق");
      loadRequests();
    }catch(e){
      console.error("VERIFICATION DELETE ERROR:",e);
      alert("❌ حدث خطأ أثناء حذف الطلب");
    }
  };

  return(
    <div>
      <h4 style={{color:"#34d399"}}>
        📸 طلبات التوثيق ({requests.length})
      </h4>

      {requests.map(r=>(
        <div
          key={r.id}
          style={{
            padding:"12px",
            background:"rgba(255,255,255,0.05)",
            borderRadius:"12px",
            marginBottom:"10px"
          }}
        >
          <div style={{fontWeight:"900"}}>
            {r.name} - {r.email}
          </div>

          <div style={{fontSize:"12px",color:"#aaa",marginTop:"5px"}}>
            🆔 ID المستخدم: {r.user_id}
          </div>

          {r.video && (
            <>
              <video
                src={r.video}
                controls
                style={{
                  width:"100%",
                  maxHeight:"300px",
                  borderRadius:"12px",
                  marginTop:"10px"
                }}
              />

              <a
                href={r.video}
                download={"verification_"+r.id+".webm"}
                style={{
                  display:"block",
                  textAlign:"center",
                  marginTop:"8px",
                  padding:"8px",
                  background:"#3b82f6",
                  color:"#fff",
                  borderRadius:"10px",
                  textDecoration:"none"
                }}
              >
                💾 حفظ الفيديو
              </a>
            </>
          )}

          <div style={{
            fontSize:"12px",
            color:"#aaa",
            marginTop:"8px"
          }}>
            الحالة: {r.status}
          </div>

          {r.status==="pending" ? (
            <div style={{
              display:"flex",
              gap:"8px",
              marginTop:"10px"
            }}>
              <button
                onClick={()=>action(r.id,"approve")}
                style={{
                  flex:1,
                  background:"#10b981",
                  color:"#fff",
                  border:"none",
                  padding:"9px",
                  borderRadius:"8px",
                  fontWeight:"900"
                }}
              >
                ✅ موافقة
              </button>

              <button
                onClick={()=>action(r.id,"reject")}
                style={{
                  flex:1,
                  background:"#ef4444",
                  color:"#fff",
                  border:"none",
                  padding:"9px",
                  borderRadius:"8px",
                  fontWeight:"900"
                }}
              >
                ❌ رفض
              </button>

              <button
                onClick={()=>deleteRequest(r.id)}
                style={{
                  flex:1,
                  background:"#111827",
                  color:"#fff",
                  border:"none",
                  padding:"9px",
                  borderRadius:"8px",
                  fontWeight:"900"
                }}
              >
                🗑 حذف
              </button>
            </div>
          ) : (
            <div style={{
              display:"flex",
              gap:"8px",
              alignItems:"center",
              marginTop:"10px"
            }}>
              <b style={{flex:1}}>
                {r.status==="approved"
                  ? "تمت الموافقة ✅"
                  : "تم الرفض ❌"}
              </b>

              <button
                onClick={()=>deleteRequest(r.id)}
                style={{
                  background:"#111827",
                  color:"#fff",
                  border:"none",
                  padding:"8px 14px",
                  borderRadius:"8px",
                  fontWeight:"900"
                }}
              >
                🗑 حذف
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AdminWithdraw(){
  const [requests,setRequests]=useState([]);

  const loadRequests=async()=>{
    const res=await fetch(`${window.location.origin}/api/admin/withdraw`,{
    });
    const data=await res.json();
    if(data.success){
      setRequests(data.requests);
    }
  };

  useEffect(()=>{
    loadRequests();
  },[]);

  const action=async(id,type)=>{
    await fetch(
      `${window.location.origin}/api/admin/withdraw/${type}/${id}`,
      {
        method:"POST"
      }
    );
    loadRequests();
  };

  return(
    <div>
      <h4 style={{color:"#ef4444"}}>
        📥 طلبات السحب ({requests.length})
      </h4>

      {requests.map(r=>(
        <div key={r.id}
        style={{
          padding:"14px",
          background:"rgba(255,255,255,0.05)",
          borderRadius:"14px",
          marginBottom:"12px"
        }}>

          <div>👤 {r.name}</div>
          <div>📧 {r.email}</div>
          <div>💰 النقاط: {r.points}</div>
          <div>💳 الطريقة: {r.method}</div>
          <div>📱 المحفظة: {r.wallet_num || "-"}</div>
          <div>📝 ملاحظات: {r.notes || "-"}</div>
          <div>💵 المبلغ: {r.amount_syr || "-"} ل.س</div>

          <div style={{fontSize:"12px",color:"#aaa",marginTop:"8px"}}>
            📅 {r.created_at}
          </div>

          <div style={{marginTop:"8px"}}>
            الحالة: {r.status}
          </div>

          {r.status==="pending" &&
          <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>

            <button
            onClick={()=>action(r.id,"approve")}
            style={{
              flex:1,
              background:"#10b981",
              color:"#fff",
              border:"none",
              padding:"8px",
              borderRadius:"8px"
            }}>
              قبول
            </button>

            <button
            onClick={()=>action(r.id,"reject")}
            style={{
              flex:1,
              background:"#ef4444",
              color:"#fff",
              border:"none",
              padding:"8px",
              borderRadius:"8px"
            }}>
              رفض
            </button>

          </div>}

        </div>
      ))}
    </div>
  );
}

function AdminReports(){

  const [reports,setReports]=useState([]);

  const loadReports=async()=>{

    const res=await fetch(`${window.location.origin}/api/admin/reports`,{
    });

    const data=await res.json();

    if(data.success){
      setReports(data.reports);
    }
  };


  useEffect(()=>{
    loadReports();
  },[]);


  const action=async(id,type)=>{

    await fetch(
      `${window.location.origin}/api/admin/reports/${type}/${id}`,
      {
        method:"POST"
      }
    );

    loadReports();
  };


  return(
    <div>
      <h4 style={{color:"#f59e0b"}}>
        ⚠️ البلاغات ({reports.length})
      </h4>

      {reports.map(r=>(
        <div key={r.id}
        style={{
          padding:"12px",
          background:"rgba(255,255,255,0.05)",
          borderRadius:"12px",
          marginBottom:"10px"
        }}>

          <div>
            🚨 {r.reporter_name} ضد {r.target_name}
          </div>

          <div>
            السبب: {r.reason}
          </div>

          <div style={{fontSize:"12px",color:"#aaa"}}>
            الحالة: {r.status}
          </div>

          {r.status==="pending" &&
          <div style={{display:"flex",gap:"8px",marginTop:"8px"}}>

            <button
            onClick={()=>action(r.id,"resolve")}
            style={{
              flex:1,
              background:"#ef4444",
              color:"#fff",
              border:"none",
              padding:"8px",
              borderRadius:"8px"
            }}>
              قبول وحظر
            </button>

            <button
            onClick={()=>action(r.id,"reject")}
            style={{
              flex:1,
              background:"#10b981",
              color:"#fff",
              border:"none",
              padding:"8px",
              borderRadius:"8px"
            }}>
              رفض
            </button>

          </div>}

        </div>
      ))}

    </div>
  );
}
