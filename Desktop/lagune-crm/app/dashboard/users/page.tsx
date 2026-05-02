'use client'
import { useState, useEffect } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { Profile } from '@/lib/types'

export default function UsersPage() {
  const supabase = createClientComponentClient()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [nom, setNom] = useState('')
  const [email, setEmail] = useState('')
  const [pwd, setPwd] = useState('')
  const [role, setRole] = useState<'commercial'|'manager'|'admin'>('commercial')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const load = async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setProfiles(data || [])
  }
  useEffect(() => { load() }, [])

  const toggle = async (id: string, actif: boolean) => {
    await supabase.from('profiles').update({ actif: !actif }).eq('id', id)
    showToast(actif ? '🔒 Utilisateur désactivé' : '✅ Utilisateur activé')
    load()
  }

  const createUser = async () => {
    if (!nom || !email || !pwd) return
    setSaving(true)
    const colors = ['#1a3a4a','#2a7a8a','#c9a84c','#8b5fe8','#2d8a5e','#e05a3a']
    const color = colors[profiles.length % colors.length]
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nom, email, pwd, role, color }) })
    setSaving(false)
    if (res.ok) { setShowAdd(false); setNom(''); setEmail(''); setPwd(''); showToast('✅ Utilisateur créé'); load() }
    else { const err = await res.json(); showToast('❌ ' + (err.error || 'Erreur')) }
  }

  const roleLabel = { admin: 'Admin', manager: 'Manager', commercial: 'Commercial' }
  const roleColor = { admin: '#c9a84c', manager: '#2a7a8a', commercial: '#2d8a5e' }

  const inp: any = { width: '100%', padding: '10px 12px', border: '1.5px solid rgba(26,58,74,0.12)', borderRadius: '8px', fontFamily: 'Outfit,sans-serif', fontSize: '13px', color: '#1a1a1a', outline: 'none', marginTop: '5px' }
  const lbl: any = { display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#9a9a9a' }

  return (
    <div style={{ padding: '24px 28px', fontFamily: 'Outfit,sans-serif', maxWidth: '700px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: '24px', fontWeight: 600, color: '#1a3a4a' }}>Utilisateurs</h2>
          <p style={{ fontSize: '12px', color: '#9a9a9a' }}>{profiles.length} comptes</p>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ background: '#1a3a4a', color: 'white', border: 'none', borderRadius: '9px', padding: '10px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Outfit,sans-serif' }}>
          ➕ Nouvel utilisateur
        </button>
      </div>

      {profiles.map(u => (
        <div key={u.id} style={{ background: 'white', borderRadius: '12px', border: '1px solid rgba(26,58,74,0.1)', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '10px' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: u.color||'#2a7a8a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 700, color: 'white', flexShrink: 0 }}>
            {u.nom[0]}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a3a4a' }}>{u.nom}</div>
            <div style={{ fontSize: '12px', color: '#9a9a9a', marginTop: '2px' }}>
              {u.email} —{' '}
              <span style={{ color: (roleColor as any)[u.role], fontWeight: 600 }}>{(roleLabel as any)[u.role]}</span>
              {!u.actif && <span style={{ color: '#e05a3a', marginLeft: '8px' }}>• Désactivé</span>}
            </div>
          </div>
          <button onClick={() => toggle(u.id, u.actif)} style={{ padding: '7px 14px', borderRadius: '8px', border: `1px solid ${u.actif?'rgba(224,90,58,0.3)':'rgba(45,138,94,0.3)'}`, background: u.actif?'rgba(224,90,58,0.08)':'rgba(45,138,94,0.08)', color: u.actif?'#e05a3a':'#2d8a5e', fontFamily: 'Outfit,sans-serif', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
            {u.actif ? 'Désactiver' : 'Activer'}
          </button>
        </div>
      ))}

      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,26,38,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, backdropFilter: 'blur(4px)', padding: '20px' }} onClick={e => { if(e.target===e.currentTarget) setShowAdd(false) }}>
          <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '480px', overflow: 'hidden' }}>
            <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid rgba(26,58,74,0.1)', display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: '20px', fontWeight: 600, color: '#1a3a4a' }}>👤 Nouvel utilisateur</h3>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#9a9a9a' }}>✕</button>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div><label style={lbl}>Nom complet</label><input value={nom} onChange={e=>setNom(e.target.value)} style={inp} placeholder="Prénom Nom" /></div>
              <div><label style={lbl}>Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} style={inp} placeholder="email@laguneprande.ma" /></div>
              <div><label style={lbl}>Mot de passe</label><input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} style={inp} placeholder="Minimum 6 caractères" /></div>
              <div><label style={lbl}>Rôle</label>
                <select value={role} onChange={e=>setRole(e.target.value as any)} style={{...inp,cursor:'pointer'}}>
                  <option value="commercial">Commercial</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div style={{ padding: '14px 22px', borderTop: '1px solid rgba(26,58,74,0.1)', display: 'flex', gap: '10px', justifyContent: 'flex-end', background: '#f5f0e8' }}>
              <button onClick={() => setShowAdd(false)} style={{ background: 'white', color: '#5a5a5a', border: '1.5px solid rgba(26,58,74,0.12)', borderRadius: '9px', padding: '9px 18px', fontSize: '13px', cursor: 'pointer', fontFamily: 'Outfit,sans-serif' }}>Annuler</button>
              <button onClick={createUser} disabled={saving||!nom||!email||!pwd} style={{ background: '#1a3a4a', color: 'white', border: 'none', borderRadius: '9px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Outfit,sans-serif', opacity: saving||!nom||!email||!pwd ? 0.5 : 1 }}>
                {saving ? 'Création...' : '✅ Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: '24px', right: '24px', background: '#1a3a4a', color: 'white', padding: '12px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: 500, boxShadow: '0 8px 30px rgba(0,0,0,0.2)', zIndex: 999 }}>{toast}</div>}
    </div>
  )
}
