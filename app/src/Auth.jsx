import React from 'react';

export function Login({ setPage, chg, handleLogin }) {
  return (
    <div className="auth-container" style={{ width: '100%', maxWidth: '400px', marginTop: '10vh', background: 'rgba(26,21,37,0.65)', border: '1px solid rgba(255,255,255,0.06)', padding: '30px', borderRadius: '24px' }}>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <div style={{ fontSize: '36px', fontWeight: 'bold', background: 'linear-gradient(45deg, #ff6b8b, #8a2be2)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>سوريانا</div>
        <p style={{ color: '#9ca3af', marginTop: '6px' }}>أهلاً بك في سوريانا 💚❤️</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <input type="email" name="email" placeholder="البريد الإلكتروني" className="input-custom" onChange={chg} />
        <input type="password" name="password" placeholder="كلمة المرور" className="input-custom" onChange={chg} />
        <button type="button" className="btn-primary-custom" onClick={handleLogin}>تسجيل الدخول</button>
        <button type="button" className="btn-primary-custom" onClick={() => setPage("register")} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', marginTop: '4px', boxShadow: 'none' }}>إنشاء حساب جديد</button>
      </div>
    </div>
  );
}

export function Register({ setPage, chg, form, handleRegisterSubmit }) {
  return (
    <div style={{ padding: '20px', width: '100%', maxWidth: '400px', marginTop: '5vh' }}>
      <form onSubmit={handleRegisterSubmit} className="auth-container" style={{ width: "100%", background: "rgba(26,21,37,0.65)", border: "1px solid rgba(255,255,255,0.06)", padding: "24px", borderRadius: "24px" }}>
        <div style={{ textAlign: "center", marginBottom: "20px" }}><div style={{ fontSize: "24px", fontWeight: "bold" }}>إنشاء حساب جديد</div></div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <input type="text" name="name" placeholder="الاسم الظاهر" className="input-custom" required onChange={chg} />
          <input type="email" name="email" placeholder="الإيميل" className="input-custom" required onChange={chg} />
          <input type="password" name="password" placeholder="كلمة المرور" className="input-custom" required onChange={chg} />
          
          {/* حقول العمر والمحافظة جنب بعض وإجبارية */}
          <div style={{ display: "flex", gap: "12px" }}>
            <input type="number" name="age" placeholder="العمر" className="input-custom" style={{ flex: 1 }} required onChange={chg} />
            <input type="text" name="city" placeholder="المحافظة" className="input-custom" style={{ flex: 1 }} required onChange={chg} />
          </div>
          
          {/* قائمة خيارات الجنس المنسدلة الإجبارية */}
          <div style={{ position: 'relative' }}>
            <select name="gender" className="input-custom" value={form.gender} style={{ width: '100%', appearance: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '14px 20px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px' }} required onChange={chg}>
              <option value="ذكر" style={{ background: '#1a1525', color: '#fff' }}>ذكر (شاب)</option>
              <option value="أنثى" style={{ background: '#1a1525', color: '#fff' }}>أنثى (بنت)</option>
            </select>
            <span style={{ position: 'absolute', left: '16px', top: '16px', pointerEvents: 'none', color: '#9ca3af', fontSize: '12px' }}>▼</span>
          </div>

          <button type="submit" className="btn-primary-custom" style={{ marginTop: '8px' }}>إنشاء الحساب</button>
          <button type="button" className="btn-primary-custom" onClick={() => setPage("login")} style={{ background: "transparent", border: "none", color: "#9ca3af", boxShadow: "none" }}>تسجيل الدخول</button>
        </div>
      </form>
    </div>
  );
}
