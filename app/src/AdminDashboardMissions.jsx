import React, { useState } from 'react';

export function AdminDashboardMissions({ stats }) {
  const [sub, setSub] = useState("users");
  return (
    <div className="auth-container" style={{ padding: "20px", borderRadius: "24px", background: "rgba(20,16,30,0.95)", border: "1px solid #fbbf24", textAlign: "right" }}>
      <h2 style={{ color: "#fbbf24", textAlign: "center", marginBottom: "16px", fontSize: "16px" }}>👑 لوحة الإدارة العليا لـ جعفر ليلى</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px" }}>
        <button type="button" style={{ height: "36px", background: sub==="users"?"#fbbf24":"rgba(255,255,255,0.04)", color: sub==="users"?"#000":"#fff", border: "none", borderRadius: "10px", fontSize: "11px", fontWeight: "bold" }} onClick={()=>setSub("users")}>👥 المشتركين (١٦٤)</button>
        <button type="button" style={{ height: "36px", background: sub==="verify"?"#34d399":"rgba(255,255,255,0.04)", color: sub==="verify"?"#000":"#fff", border: "none", borderRadius: "10px", fontSize: "11px", fontWeight: "bold" }} onClick={()=>setSub("verify")}>📸 التوثيق (١٢)</button>
        <button type="button" style={{ height: "36px", background: sub==="withdraw"?"#ef4444":"rgba(255,255,255,0.04)", color: sub==="withdraw"?"#000":"#fff", border: "none", borderRadius: "10px", fontSize: "11px", fontWeight: "bold" }} onClick={()=>setSub("withdraw")}>📥 السحب (٣)</button>
        <button type="button" style={{ height: "36px", background: sub==="reports"?"#f59e0b":"rgba(255,255,255,0.04)", color: sub==="reports"?"#000":"#fff", border: "none", borderRadius: "10px", fontSize: "11px", fontWeight: "bold" }} onClick={()=>setSub("reports")}>⚠️ الإبلاغات (٢)</button>
      </div>
      {sub === "users" && (
        <div>
          <h4 style={{ color: "#fbbf24", margin: "0 0 10px 0", fontSize: "14px" }}>👥 المشتركين والحظر:</h4>
          {[{ id: 1, name: "سامر السوري", status: "نشط" }, { id: 2, name: "أحمد حلب", status: "محظور" }].map(u => (
            <div key={u.id} style={{ background: "rgba(255,255,255,0.02)", padding: "10px", borderRadius: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <button type="button" style={{ background: u.status==="نشط"?"#ef4444":"#10b981", color: "#fff", border: "none", padding: "4px 12px", borderRadius: "8px" }} onClick={()=>alert(u.status==="نشط"?"❌ تم الحظر!":"✓ رفع الحظر")}>{u.status==="نشط"?"حظر":"رفع الحظر"}</button>
              <span>{u.name} - <b style={{color: u.status==="نشط"?"#10b981":"#ef4444"}}>{u.status}</b></span>
            </div>
          ))}
        </div>
      )}
      {sub === "verify" && (
        <div>
          <h4 style={{ color: "#34d399", margin: "0 0 10px 0", fontSize: "14px" }}>📸 طلبات التوثيق سيلفي:</h4>
          <div style={{ background: "rgba(255,255,255,0.02)", padding: "12px", borderRadius: "14px", textAlign: "center" }}>
            <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "6px" }}>ريم (٢٢ سنة) - حمص</div>
            <div style={{ width: "100%", height: "100px", background: "rgba(255,255,255,0.05)", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: "#6b7280", marginBottom: "10px" }}>🖼️ [صورة السيلفي المرفوعة]</div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" style={{ flex: 1, background: "#10b981", border: "none", height: "32px", borderRadius: "8px", fontWeight: "bold" }} onClick={()=>alert("✓ تم تفعيل بوابات السحب والصح الأزرق!")}>توافق واقبل</button>
              <button type="button" style={{ flex: 1, background: "#ef4444", color: "#fff", border: "none", height: "32px", borderRadius: "8px" }} onClick={()=>alert("رفض الطلب")}>ارفض الطلب</button>
            </div>
          </div>
        </div>
      )}
      {sub === "withdraw" && (
        <div>
          <h4 style={{ color: "#ef4444", margin: "0 0 10px 0", fontSize: "14px" }}>📥 كشوفات وطلبات السحب كاش:</h4>
          <div style={{ background: "rgba(255,255,255,0.02)", padding: "12px", borderRadius: "14px" }}>
            <div style={{ color: "#fbbf24", fontWeight: "bold" }}>المستلمة: لينا الشام</div>
            <div style={{ color: "#9ca3af", fontSize: "11px", marginTop: "4px" }}>المبلغ: ٥,٠٠٠ نقطة = ٥٠,٠٠٠ ل.س (شام كاش: 4ec84c00d1)</div>
            <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
              <button type="button" style={{ flex: 1, background: "#10b981", border: "none", height: "30px", borderRadius: "8px", fontWeight: "bold" }} onClick={()=>alert("💸 تم تأكيد تحويل الكاش بنجاح!")}>✓ تم التحويل كاش</button>
              <button type="button" style={{ flex: 1, background: "#ef4444", color: "#fff", border: "none", height: "30px", borderRadius: "8px" }} onClick={()=>alert("رفض وإرجاع")}>رفض وإرجاع</button>
            </div>
          </div>
        </div>
      )}
      {sub === "reports" && (
        <div>
          <h4 style={{ color: "#f59e0b", margin: "0 0 10px 0", fontSize: "14px" }}>⚠️ قسم الإبلاغات والشكاوى حياً:</h4>
          <div style={{ background: "rgba(255,255,255,0.02)", padding: "12px", borderRadius: "14px", fontSize: "12px" }}>
            <div style={{ color: "#ef4444", fontWeight: "bold" }}>🚨 بلاغ احتيال: سامر ضد ريم</div>
            <div style={{ color: "#9ca3af", marginTop: "4px" }}>السبب: تطلب رصيد خارج المنصة!</div>
            <button type="button" style={{ background: "#f59e0b", border: "none", padding: "4px 10px", borderRadius: "6px", marginTop: "8px", fontWeight: "bold" }} onClick={()=>alert("👁️ جاري فتح سجل الشات بالكامل للمراجعة الإدارية!")}>👁️ مراجعة الشات بالكامل</button>
          </div>
        </div>
      )}
      <button type="button" className="btn-primary-custom" style={{ background: "rgba(255,255,255,0.05)", marginTop: "20px", height: "40px" }} onClick={() => { window.location.reload(); }}>تسجيل خروج المدير ❮</button>
    </div>
  );
}
