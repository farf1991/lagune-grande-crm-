'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { Lead, Profile, STATUTS, SOURCES, MOTIFS_PERTE, STATUT_COLORS, SOURCE_COLORS } from '@/lib/types'

// ============ HELPERS ============
function hoursAgo(dateStr: string) { return Math.floor((Date.now() - new Date(dateStr).getTime()) / 3600000) }
function ageBadge(dateStr: string) {
  const h = hoursAgo(dateStr)
  if (h < 24) return { color: '#2d8a5e', bg: 'rgba(45,138,94,0.1)', text: `${h}h`, icon: '🟢' }
  if (h < 48) return { color: '#d4852a', bg: 'rgba(212,133,42,0.1)', text: `${Math.floor(h/24)}j`, icon: '🟡' }
  return { color: '#e05a3a', bg: 'rgba(224,90,58,0.1)', text: `${Math.floor(h/24)}j`, icon: '🔴' }
}
function fmtDate(d: string) {
  const dt = new Date(d)
  return dt.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) + ' ' + dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})
}
function sourceCls(source: string) {
  const map: any = { Facebook:'#4267b2', Instagram:'#c13584', Google:'#4285f4', TikTok:'#333', 'Site web':'#2a7a8a', Référence:'#c9a84c', Autre:'#9a9a9a' }
  return map[source] || '#9a9a9a'
}
function statusStyle(statut: string) {
  const color = (STATUT_COLORS as any)[statut] || '#aaa'
  return { color, background: color + '20', padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' as const }
}

// ============ MAIN ============
export default function LeadsPage() {
  const supabase = createClientComponentClient()
  const [leads, setLeads] = useState<Lead[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [me, setMe] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'espace'|'table'|'kanban'>('table')
  const [search, setSearch] = useState('')
  const [filterStatut, setFilterStatut] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterAssigne, setFilterAssigne] = useState('')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showPerdu, setShowPerdu] = useState(false)
  const [pendingStatut, setPendingStatut] = useState<{leadId:number,statut:string}|null>(null)
  const [motifSeleceted, setMotifSelected] = useState('')
  const [motifComment, setMotifComment] = useState('')
  const [logNote, setLogNote] = useState('')
  const [toast, setToast] = useState('')
  const [relanceInput, setRelanceInput] = useState('')
  const [commentaireInterne, setCommentaireInterne] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
    setMe(prof)
    const { data: profs } = await supabase.from('profiles').select('*')
    setProfiles(profs || [])
    const isManager = prof?.role === 'admin' || prof?.role === 'manager'
    if (prof?.role === 'commercial') setView('espace')
    let q = supabase.from('leads').select('*, lead_logs(*), profile:assigne_id(*)').order('created_at', { ascending: false })
    if (!isManager) q = q.eq('assigne_id', session.user.id)
    const { data } = await q
    setLeads(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    setCommentaireInterne(selectedLead?.commentaire_interne || '')
    setRelanceInput(selectedLead?.relance_date?.slice(0, 16) || '')
  }, [selectedLead?.id])

  const isManager = me?.role === 'admin' || me?.role === 'manager'
  const commerciaux = profiles.filter(p => p.role === 'commercial')

  const filtered = leads.filter(l => {
    if (search) { const q = search.toLowerCase(); if (!l.nom.toLowerCase().includes(q) && !l.tel.includes(q)) return false }
    if (filterStatut && l.statut !== filterStatut) return false
    if (filterSource && l.source !== filterSource) return false
    if (filterAssigne && l.assigne_id !== filterAssigne) return false
    return true
  })

  const relancesToday = leads.filter(l => {
    if (!l.relance_date) return false
    const todayEnd = new Date(); todayEnd.setHours(23,59,59)
    return new Date(l.relance_date) <= todayEnd
  })

  // ---- ACTIONS ----
  const changeStatut = async (leadId: number, statut: string) => {
    if (statut === 'Perdu') { setPendingStatut({ leadId, statut }); setShowPerdu(true); return }
    const lead = leads.find(l => l.id === leadId)
    const updates: any = { statut }
    if (lead && !lead.relance_date && !['Vendu', 'Perdu'].includes(statut)) {
      updates.relance_date = new Date(Date.now() + 48 * 3600 * 1000).toISOString()
    }
    const { error } = await supabase.from('leads').update(updates).eq('id', leadId)
    if (!error) {
      await supabase.from('lead_logs').insert({ lead_id: leadId, auteur_id: me?.id, action: `Statut → ${statut}`, result: null, note: '' })
      showToast(`✅ Statut : ${statut}`)
      loadData()
      if (selectedLead?.id === leadId) setSelectedLead(prev => prev ? { ...prev, statut: statut as any } : null)
    }
  }

  const confirmPerdu = async () => {
    if (!motifSeleceted || !pendingStatut) return
    await supabase.from('leads').update({ statut: 'Perdu', motif_perdu: motifSeleceted }).eq('id', pendingStatut.leadId)
    await supabase.from('lead_logs').insert({ lead_id: pendingStatut.leadId, auteur_id: me?.id, action: `Lead perdu — ${motifSeleceted}${motifComment?' : '+motifComment:''}`, note: '' })
    setShowPerdu(false); setMotifSelected(''); setMotifComment(''); setPendingStatut(null)
    showToast('❌ Lead perdu enregistré'); loadData()
  }

  const saveRelance = async (leadId: number, val: string) => {
    await supabase.from('leads').update({ relance_date: val || null }).eq('id', leadId)
    if (val) await supabase.from('lead_logs').insert({ lead_id: leadId, auteur_id: me?.id, action: `Relance programmée : ${fmtDate(val)}`, note: '' })
    showToast('🔔 Relance enregistrée'); loadData()
  }

  const logAppel = async (leadId: number, result: string) => {
    await supabase.from('lead_logs').insert({ lead_id: leadId, auteur_id: me?.id, action: 'Mémo appel', result, note: logNote })
    const lead = leads.find(l => l.id === leadId)
    if (lead) {
      const updates: any = {}
      if (result === 'Répondu' && lead.statut === 'Nouveau') updates.statut = 'Contacté'
      if (result === 'Pas répondu' && lead.statut === 'Contacté') updates.statut = 'Relance 1'
      // Auto-relance 48h si aucune relance programmée et lead actif
      if (!lead.relance_date && !['Vendu', 'Perdu'].includes(lead.statut)) {
        updates.relance_date = new Date(Date.now() + 48 * 3600 * 1000).toISOString()
      }
      if (Object.keys(updates).length > 0) await supabase.from('leads').update(updates).eq('id', leadId)
    }
    setLogNote(''); showToast(`📞 Appel loggué : ${result}`); loadData()
    const { data } = await supabase.from('leads').select('*, lead_logs(*), profile:assigne_id(*)').eq('id', leadId).single()
    if (data) setSelectedLead(data)
  }

  const saveCommentInterne = async (leadId: number, val: string) => {
    await supabase.from('leads').update({ commentaire_interne: val }).eq('id', leadId)
    showToast('⭐ Commentaire sauvegardé')
  }

  const exportExcel = async () => {
    const XLSX = (await import('xlsx')).default
    const data = filtered.map(l => {
      const com = profiles.find(p => p.id === l.assigne_id)
      return { Nom: l.nom, Téléphone: l.tel, Ville: l.ville||'', Besoin: l.besoin||'', Horaire: l.horaire||'', Source: l.source, Statut: l.statut, 'Motif perte': l.motif_perdu||'', Commercial: com?.nom||'', 'Créé le': new Date(l.created_at).toLocaleDateString('fr-FR'), Relance: l.relance_date?fmtDate(l.relance_date):'' }
    })
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Leads')
    XLSX.writeFile(wb, `Lagune_Grande_${new Date().toISOString().slice(0,10)}.xlsx`)
    showToast('📤 Export téléchargé')
  }

  if (loading) return <div style={{ padding: 40, color: '#9a9a9a', fontFamily: 'Outfit,sans-serif' }}>Chargement...</div>

  return (
    <div style={{ padding: '24px 28px', fontFamily: 'Outfit,sans-serif' }}>
      {/* Topbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: '24px', fontWeight: 600, color: '#1a3a4a' }}>Leads</h2>
          <p style={{ fontSize: '12px', color: '#9a9a9a' }}>{filtered.length} leads{search||filterStatut||filterSource ? ' (filtrés)' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={exportExcel} style={btnOutline}>📤 Export</button>
          {me?.role === 'admin' && <button onClick={() => setShowAdd(true)} style={btnPrimary}>➕ Nouveau lead</button>}
        </div>
      </div>

      {/* Relances */}
      {relancesToday.length > 0 && (
        <div style={{ background: '#fff8e8', border: '1.5px solid #c9a84c', borderRadius: '12px', padding: '14px 18px', marginBottom: '16px', display: 'flex', gap: '12px' }}>
          <span style={{ fontSize: '22px' }}>🔔</span>
          <div>
            <b style={{ color: '#1a3a4a', fontSize: '14px' }}>{relancesToday.length} relance{relancesToday.length>1?'s':''} aujourd&apos;hui</b>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
              {relancesToday.map(l => (
                <button key={l.id} onClick={() => setSelectedLead(l)} style={{ background: 'white', border: `1px solid ${new Date(l.relance_date!) < new Date() ? '#e05a3a' : '#c9a84c'}`, borderRadius: '20px', padding: '4px 11px', fontSize: '12px', fontWeight: 600, color: new Date(l.relance_date!) < new Date() ? '#e05a3a' : '#1a3a4a', cursor: 'pointer' }}>
                  {new Date(l.relance_date!) < new Date() ? '⚠️' : '📞'} {l.nom}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'white', border: '1.5px solid rgba(26,58,74,0.12)', borderRadius: '9px', padding: '9px 14px', flex: 1, minWidth: '220px' }}>
          <span style={{ color: '#9a9a9a' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..." style={{ border: 'none', outline: 'none', fontSize: '13px', fontFamily: 'Outfit,sans-serif', width: '100%', color: '#1a1a1a' }} />
        </div>
        <select value={filterStatut} onChange={e => setFilterStatut(e.target.value)} style={selStyle}>
          <option value="">Tous statuts</option>
          {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} style={selStyle}>
          <option value="">Toutes sources</option>
          {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {isManager && (
          <select value={filterAssigne} onChange={e => setFilterAssigne(e.target.value)} style={selStyle}>
            <option value="">Tous commerciaux</option>
            {commerciaux.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', gap: '4px', background: 'white', border: '1.5px solid rgba(26,58,74,0.12)', borderRadius: '9px', padding: '4px' }}>
          {([['espace','🎯 Mon espace'],['table','📋 Tableau'],['kanban','🗂️ Kanban']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', fontFamily: 'Outfit,sans-serif', fontWeight: 500, background: view === v ? '#1a3a4a' : 'none', color: view === v ? 'white' : '#9a9a9a', transition: 'all 0.15s' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* MON ESPACE VIEW */}
      {view === 'espace' && (() => {
        const nouveaux = leads
          .filter(l => l.statut === 'Nouveau')
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        const relances = leads
          .filter(l => l.relance_date && l.statut !== 'Nouveau' && l.statut !== 'Vendu' && l.statut !== 'Perdu')
          .sort((a, b) => new Date(a.relance_date!).getTime() - new Date(b.relance_date!).getTime())

        const relanceLabel = (d: string) => {
          const diff = Math.floor((new Date(d).getTime() - Date.now()) / 86400000)
          if (diff < -1) return { text: `En retard de ${-diff}j`, color: '#e05a3a' }
          if (diff < 0) return { text: 'En retard', color: '#e05a3a' }
          if (diff === 0) return { text: "Aujourd'hui", color: '#d4852a' }
          if (diff === 1) return { text: 'Demain', color: '#2a7a8a' }
          return { text: `Dans ${diff}j`, color: '#2a7a8a' }
        }

        const EspaceCard = ({ lead, type }: { lead: Lead; type: 'nouveau' | 'relance' }) => {
          const h = hoursAgo(lead.created_at)
          const ageColor = h < 24 ? '#2d8a5e' : h < 48 ? '#d4852a' : '#e05a3a'
          const rl = lead.relance_date ? relanceLabel(lead.relance_date) : null
          const border = type === 'relance' && rl?.color === '#e05a3a' ? '#e05a3a'
            : type === 'nouveau' && h >= 48 ? '#e05a3a' : 'rgba(26,58,74,0.1)'
          return (
            <div onClick={() => setSelectedLead(lead)} style={{ background: 'white', borderRadius: '12px', border: `1.5px solid ${border}`, padding: '14px 18px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(26,58,74,0.05)', display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '15px', fontWeight: 700, color: '#1a3a4a' }}>{lead.nom}</span>
                  <span style={{ fontSize: '13px', color: '#2a7a8a', fontWeight: 600 }}>{lead.tel}</span>
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '4px', flexWrap: 'wrap' }}>
                  {lead.ville && <span style={{ fontSize: '12px', color: '#9a9a9a' }}>📍 {lead.ville}</span>}
                  {lead.besoin && <span style={{ fontSize: '12px', color: '#9a9a9a' }}>🏠 {lead.besoin}</span>}
                  {lead.horaire && <span style={{ fontSize: '12px', color: '#9a9a9a' }}>⏰ {lead.horaire}</span>}
                  {type === 'relance' && <span style={statusStyle(lead.statut)}>{lead.statut}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', flex:'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                {type === 'nouveau' && (
                  <span style={{ fontSize: '11px', fontWeight: 700, color: ageColor, background: ageColor + '18', padding: '3px 8px', borderRadius: '8px' }}>
                    {h < 24 ? `${h}h` : `${Math.floor(h/24)}j`}
                  </span>
                )}
                {type === 'relance' && rl && (
                  <span style={{ fontSize: '11px', fontWeight: 700, color: rl.color, background: rl.color + '18', padding: '3px 8px', borderRadius: '8px' }}>{rl.text}</span>
                )}
                <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                  <a href={`tel:${lead.tel}`} style={{ padding: '5px 10px', borderRadius: '6px', background: 'rgba(42,122,138,0.08)', color: '#2a7a8a', border: '1px solid rgba(42,122,138,0.2)', fontSize: '11px', fontWeight: 600, textDecoration: 'none' }}>📞</a>
                  <a href={`https://wa.me/${lead.tel.replace(/\D/g,'')}`} target="_blank" rel="noreferrer" style={{ padding: '5px 10px', borderRadius: '6px', background: 'rgba(37,211,102,0.08)', color: '#1a8a3a', border: '1px solid rgba(37,211,102,0.2)', fontSize: '11px', fontWeight: 600, textDecoration: 'none' }}>💬</a>
                </div>
              </div>
            </div>
          )
        }

        return (
          <div style={{ maxWidth: '820px' }}>
            {nouveaux.length === 0 && relances.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px', color: '#9a9a9a', fontSize: '15px', background: 'white', borderRadius: '12px', border: '1px solid rgba(26,58,74,0.1)' }}>✅ Rien à traiter</div>
            )}
            {nouveaux.length > 0 && (
              <div style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2a7a8a', display: 'inline-block' }} />
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#1a3a4a', textTransform: 'uppercase', letterSpacing: '1px' }}>Nouveaux leads à appeler</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, background: '#2a7a8a', color: 'white', padding: '2px 7px', borderRadius: '10px' }}>{nouveaux.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {nouveaux.map(l => <EspaceCard key={l.id} lead={l} type="nouveau" />)}
                </div>
              </div>
            )}
            {relances.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#d4852a', display: 'inline-block' }} />
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#1a3a4a', textTransform: 'uppercase', letterSpacing: '1px' }}>Relances</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, background: '#d4852a', color: 'white', padding: '2px 7px', borderRadius: '10px' }}>{relances.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {relances.map(l => <EspaceCard key={l.id} lead={l} type="relance" />)}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* TABLE VIEW */}
      {view === 'table' && (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid rgba(26,58,74,0.1)', overflow: 'hidden', boxShadow: '0 2px 12px rgba(26,58,74,0.06)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f5f0e8', borderBottom: '1.5px solid rgba(26,58,74,0.1)' }}>
                {['Lead','Téléphone','Ville','Source','Besoin','Horaire', ...(isManager?['Commercial']:[]), 'Statut','Ancienneté','Relance','Actions'].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#9a9a9a', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => {
                const age = ageBadge(l.created_at)
                const com = profiles.find(p => p.id === l.assigne_id)
                const isUrgent = hoursAgo(l.created_at) >= 24 && l.statut === 'Nouveau'
                return (
                  <tr key={l.id} onClick={() => setSelectedLead(l)} style={{ borderBottom: '1px solid rgba(26,58,74,0.07)', cursor: 'pointer', background: isUrgent ? 'rgba(224,90,58,0.03)' : 'white', transition: 'background 0.1s' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 600, color: '#1a3a4a', fontSize: '14px' }}>{l.nom}</div>
                      <div style={{ fontSize: '11px', color: '#9a9a9a', marginTop: '2px' }}>{l.ville||'—'}</div>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', fontWeight: 500, color: '#5a5a5a' }}>{l.tel}</td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: '#5a5a5a' }}>{l.ville||'—'}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ background: sourceCls(l.source)+'18', color: sourceCls(l.source), padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600 }}>{l.source}</span>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: '#5a5a5a' }}>{l.besoin||'—'}</td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: '#5a5a5a' }}>{l.horaire||'—'}</td>
                    {isManager && <td style={{ padding: '12px 14px', fontSize: '12px', color: '#9a9a9a' }}>{com?.nom||'—'}</td>}
                    <td style={{ padding: '12px 14px' }}><span style={statusStyle(l.statut)}>{l.statut}</span></td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ background: age.bg, color: age.color, padding: '3px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>{age.icon} {age.text}</span>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: l.relance_date && new Date(l.relance_date) < new Date() ? '#e05a3a' : '#9a9a9a' }}>
                      {l.relance_date ? fmtDate(l.relance_date) : '—'}
                    </td>
                    <td style={{ padding: '12px 14px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <a href={`https://wa.me/${l.tel.replace(/\s/g,'').replace('+','')}`} target="_blank" rel="noreferrer" style={{ padding: '4px 9px', borderRadius: '6px', background: '#25D366', color: 'white', fontSize: '11px', fontWeight: 600, textDecoration: 'none' }}>💬 WA</a>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ textAlign: 'center', padding: '50px', color: '#9a9a9a' }}>🔍 Aucun lead trouvé</div>}
        </div>
      )}

      {/* KANBAN VIEW */}
      {view === 'kanban' && (
        <div style={{ overflowX: 'auto', paddingBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '12px', minWidth: 'max-content', alignItems: 'flex-start' }}>
            {STATUTS.map(s => {
              const col = filtered.filter(l => l.statut === s)
              const color = (STATUT_COLORS as any)[s]
              return (
                <div key={s} style={{ width: '200px', background: '#ede5d4', borderRadius: '12px', border: '1px solid rgba(26,58,74,0.1)', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(26,58,74,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color }}>{s}</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, background: 'white', padding: '2px 7px', borderRadius: '10px', color: '#5a5a5a' }}>{col.length}</span>
                  </div>
                  <div style={{ padding: '8px', minHeight: '80px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                    {col.map(l => (
                      <div key={l.id} onClick={() => setSelectedLead(l)} style={{ background: 'white', borderRadius: '8px', padding: '10px', border: `1px solid ${hoursAgo(l.created_at)>=24&&s==='Nouveau'?'#e05a3a':'rgba(26,58,74,0.1)'}`, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a3a4a' }}>{l.nom}</div>
                        <div style={{ fontSize: '11px', color: '#9a9a9a', marginTop: '2px' }}>{l.tel}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '7px' }}>
                          <span style={{ fontSize: '10px', color: sourceCls(l.source), background: sourceCls(l.source)+'18', padding: '2px 6px', borderRadius: '6px', fontWeight: 600 }}>{l.source}</span>
                          {l.relance_date && <span style={{ fontSize: '10px', color: new Date(l.relance_date)<new Date()?'#e05a3a':'#d4852a', fontWeight: 600 }}>🔔</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ===== LEAD DETAIL MODAL ===== */}
      {selectedLead && (
        <div style={overlay} onClick={e => { if(e.target===e.currentTarget) setSelectedLead(null) }}>
          <div style={{ ...modal, maxWidth: '700px' }}>
            <div style={modalHeader}>
              <div>
                <div style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: '24px', fontWeight: 600, color: '#1a3a4a' }}>{selectedLead.nom}</div>
                <div style={{ marginTop: '6px' }}><span style={statusStyle(selectedLead.statut)}>{selectedLead.statut}</span></div>
              </div>
              <button onClick={() => setSelectedLead(null)} style={closeBtn}>✕</button>
            </div>
            <div style={{ padding: '22px', maxHeight: '70vh', overflowY: 'auto' }}>
              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
                <a href={`https://wa.me/${selectedLead.tel.replace(/\s/g,'').replace('+','')}`} target="_blank" rel="noreferrer" style={{ ...btnBase, background: '#25D366', color: 'white', textDecoration: 'none', padding: '8px 16px' }}>💬 WhatsApp</a>
                <a href={`tel:${selectedLead.tel}`} style={{ ...btnBase, background: '#2a7a8a', color: 'white', textDecoration: 'none', padding: '8px 16px' }}>📞 Appeler</a>
              </div>

              {/* Info grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
                {[
                  ['Téléphone', selectedLead.tel],
                  ['Ville', selectedLead.ville||'—'],
                  ['Source', selectedLead.source],
                  ['Besoin', selectedLead.besoin||'—'],
                  ['Horaire de contact', selectedLead.horaire||'—'],
                  ['Projet', selectedLead.projet],
                  ['Commercial', profiles.find(p=>p.id===selectedLead.assigne_id)?.nom||'—'],
                  ['Créé le', new Date(selectedLead.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})],
                  ['Motif perte', selectedLead.motif_perdu||'—'],
                ].map(([label, val]) => (
                  <div key={label}>
                    <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#9a9a9a', fontWeight: 600 }}>{label}</div>
                    <div style={{ fontSize: '14px', color: '#1a1a1a', marginTop: '3px', fontWeight: 500 }}>{val}</div>
                  </div>
                ))}
              </div>

              {selectedLead.notes && <div style={{ background: '#f5f0e8', borderRadius: '9px', padding: '12px', marginBottom: '16px', fontSize: '13px', color: '#5a5a5a' }}>📝 {selectedLead.notes}</div>}

              {isManager && selectedLead.commentaire_interne && (
                <div style={{ background: '#fff8e8', border: '1px solid #c9a84c', borderRadius: '9px', padding: '12px', marginBottom: '14px' }}>
                  <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#c9a84c', fontWeight: 700, marginBottom: '4px' }}>⭐ Commentaire interne</div>
                  <div style={{ fontSize: '13px', color: '#1a1a1a' }}>{selectedLead.commentaire_interne}</div>
                </div>
              )}

              <div style={{ height: '1px', background: 'rgba(26,58,74,0.1)', margin: '18px 0' }} />

              {/* Mémo appel — bloc unifié */}
              <div style={{ background: '#f5f0e8', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
                <label style={fieldLabel}>📞 Mémo appel</label>
                <textarea value={logNote} onChange={e => setLogNote(e.target.value)} placeholder="Note sur l'appel (optionnel)..." style={{ width: '100%', padding: '10px 12px', border: '1.5px solid rgba(26,58,74,0.12)', borderRadius: '8px', fontFamily: 'Outfit,sans-serif', fontSize: '13px', minHeight: '60px', resize: 'vertical', marginBottom: '12px', background: 'white', boxSizing: 'border-box' }} />
                {/* Résultat appel */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  {([['Répondu','#2d8a5e'],['Pas répondu','#e05a3a'],['Rappel demandé','#d4852a']] as const).map(([r, c]) => (
                    <button key={r} onClick={() => logAppel(selectedLead.id, r)} style={{ ...btnBase, padding: '8px 14px', fontSize: '13px', background: c + '15', color: c, border: `1.5px solid ${c}40`, fontWeight: 700 }}>{r}</button>
                  ))}
                </div>
                {/* Statuts directs */}
                <div style={{ borderTop: '1px solid rgba(26,58,74,0.1)', paddingTop: '12px' }}>
                  <div style={{ fontSize: '10px', color: '#9a9a9a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Changer le statut</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {STATUTS.filter(s => s !== 'Nouveau').map(s => {
                      const c = (STATUT_COLORS as any)[s]
                      const active = selectedLead.statut === s
                      return (
                        <button key={s} onClick={() => changeStatut(selectedLead.id, s)} style={{ padding: '5px 11px', borderRadius: '20px', border: `1.5px solid ${active ? c : c + '60'}`, background: active ? c : c + '15', color: active ? 'white' : c, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Outfit,sans-serif', transition: 'all 0.15s' }}>{s}</button>
                      )
                    })}
                  </div>
                </div>
                {/* Relance */}
                <div style={{ borderTop: '1px solid rgba(26,58,74,0.1)', paddingTop: '12px', marginTop: '12px' }}>
                  <div style={{ fontSize: '10px', color: '#9a9a9a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                    🔔 Relance programmée {!selectedLead.relance_date && <span style={{ color: '#d4852a', fontSize: '10px', fontWeight: 400, marginLeft: '4px' }}>(auto 48h si non renseigné)</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input type="datetime-local" value={relanceInput} onChange={e => setRelanceInput(e.target.value)} style={{ flex: 1, padding: '8px 12px', border: '1.5px solid rgba(26,58,74,0.15)', borderRadius: '8px', fontFamily: 'Outfit,sans-serif', fontSize: '13px', background: 'white' }} />
                    <button onClick={() => saveRelance(selectedLead.id, relanceInput)} style={{ ...btnPrimary, padding: '8px 14px', fontSize: '12px', whiteSpace: 'nowrap' }}>Enregistrer</button>
                  </div>
                </div>
              </div>

              {isManager && (
                <div style={{ background: '#fff8e8', border: '1px solid #c9a84c', borderRadius: '9px', padding: '14px', marginBottom: '16px' }}>
                  <label style={{ ...fieldLabel, color: '#c9a84c' }}>⭐ Commentaire interne</label>
                  <textarea value={commentaireInterne} onChange={e => setCommentaireInterne(e.target.value)} placeholder="Note visible manager/admin uniquement..." style={{ width: '100%', padding: '9px 12px', border: '1.5px solid rgba(201,168,76,0.3)', borderRadius: '8px', fontFamily: 'Outfit,sans-serif', fontSize: '13px', minHeight: '60px', background: 'white' }} />
                  <button onClick={() => saveCommentInterne(selectedLead.id, commentaireInterne)} style={{ ...btnBase, background: '#c9a84c', color: 'white', padding: '6px 12px', fontSize: '12px', marginTop: '8px' }}>Enregistrer</button>
                </div>
              )}

              <div style={{ height: '1px', background: 'rgba(26,58,74,0.1)', margin: '18px 0' }} />

              {/* Logs */}
              <div>
                <label style={fieldLabel}>📋 Historique</label>
                {(selectedLead.lead_logs || []).slice().reverse().filter((log: any) => {
                  if (isManager) return true
                  const a = log.action?.toLowerCase() || ''
                  return !a.includes('créé') && !a.includes('importé') && !a.includes('manuellement')
                }).map((log: any) => {
                  const auteur = profiles.find(p => p.id === log.auteur_id)
                  const color = log.result === 'Répondu' ? '#2d8a5e' : log.result === 'Pas répondu' ? '#e05a3a' : log.result === 'Rappel demandé' ? '#d4852a' : '#9a9a9a'
                  return (
                    <div key={log.id} style={{ display: 'flex', gap: '10px', padding: '10px 0', borderBottom: '1px solid rgba(26,58,74,0.07)' }}>
                      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: color, marginTop: '5px', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ fontSize: '13px', color: '#1a1a1a' }}><b>{log.action}</b>{log.note ? ' — ' + log.note : ''}</div>
                          <div style={{ fontSize: '11px', color: '#9a9a9a', whiteSpace: 'nowrap', marginLeft: '10px' }}>{fmtDate(log.created_at)}</div>
                        </div>
                        {log.result && <span style={{ display: 'inline-block', marginTop: '3px', fontSize: '11px', fontWeight: 600, color, background: color+'18', padding: '2px 8px', borderRadius: '8px' }}>{log.result}</span>}
                        {auteur && <span style={{ fontSize: '10px', color: '#9a9a9a', marginLeft: '6px' }}>{auteur.nom}</span>}
                      </div>
                    </div>
                  )
                })}
                {(!selectedLead.lead_logs || selectedLead.lead_logs.length === 0) && <p style={{ color: '#9a9a9a', fontSize: '13px' }}>Aucune action enregistrée</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== MOTIF PERDU MODAL ===== */}
      {showPerdu && (
        <div style={overlay}>
          <div style={{ ...modal, maxWidth: '440px' }}>
            <div style={modalHeader}>
              <h3 style={modalTitle}>❌ Motif de perte</h3>
              <button onClick={() => { setShowPerdu(false); setPendingStatut(null) }} style={closeBtn}>✕</button>
            </div>
            <div style={{ padding: '20px' }}>
              <p style={{ color: '#5a5a5a', fontSize: '13px', marginBottom: '12px' }}>Pourquoi ce lead est perdu ?</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                {MOTIFS_PERTE.map(m => (
                  <button key={m} onClick={() => setMotifSelected(m)} style={{ padding: '9px 12px', borderRadius: '8px', border: `1.5px solid ${motifSeleceted===m?'#e05a3a':'rgba(26,58,74,0.12)'}`, background: motifSeleceted===m?'rgba(224,90,58,0.06)':'white', fontFamily: 'Outfit,sans-serif', fontSize: '13px', cursor: 'pointer', color: motifSeleceted===m?'#e05a3a':'#5a5a5a', fontWeight: motifSeleceted===m?600:400, textAlign: 'left' }}>
                    {m}
                  </button>
                ))}
              </div>
              <textarea value={motifComment} onChange={e => setMotifComment(e.target.value)} placeholder="Commentaire (optionnel)..." style={{ width: '100%', padding: '9px 12px', border: '1.5px solid rgba(26,58,74,0.12)', borderRadius: '8px', fontFamily: 'Outfit,sans-serif', fontSize: '13px', minHeight: '60px' }} />
            </div>
            <div style={modalFooter}>
              <button onClick={() => { setShowPerdu(false); setPendingStatut(null) }} style={btnOutline}>Annuler</button>
              <button onClick={confirmPerdu} style={{ ...btnBase, background: 'rgba(224,90,58,0.12)', color: '#e05a3a', border: '1px solid rgba(224,90,58,0.3)', padding: '9px 18px' }}>Confirmer perte</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ADD LEAD MODAL ===== */}
      {showAdd && <AddLeadModal profiles={profiles} onClose={() => setShowAdd(false)} onSave={() => { setShowAdd(false); loadData(); showToast('✅ Lead ajouté') }} />}

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', background: '#1a3a4a', color: 'white', padding: '12px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: 500, boxShadow: '0 8px 30px rgba(0,0,0,0.2)', zIndex: 999, animation: 'slideUp 0.2s ease' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

function AddLeadModal({ profiles, onClose, onSave }: { profiles: Profile[], onClose: ()=>void, onSave: ()=>void }) {
  const supabase = createClientComponentClient()
  const [nom, setNom] = useState('')
  const [tel, setTel] = useState('')
  const [ville, setVille] = useState('')
  const [besoin, setBesoin] = useState('')
  const [horaire, setHoraire] = useState('')
  const [assigneId, setAssigneId] = useState(profiles.find(p=>p.role==='commercial')?.id||'')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!nom || !tel) return
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const { data: lead } = await supabase.from('leads').insert({ nom, tel, ville, besoin, horaire, source: 'Meta', assigne_id: assigneId, notes, projet: 'Lagune Grande Sidi Rahal' }).select().single()
    if (lead) await supabase.from('lead_logs').insert({ lead_id: lead.id, auteur_id: session?.user.id, action: 'Lead créé manuellement', note: '' })
    setSaving(false)
    onSave()
  }

  const commerciaux = profiles.filter(p => p.role === 'commercial')

  return (
    <div style={overlay} onClick={e => { if(e.target===e.currentTarget) onClose() }}>
      <div style={{ ...modal, maxWidth: '520px' }}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>➕ Nouveau Lead</h3>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div><label style={fieldLabel}>Nom *</label><input value={nom} onChange={e=>setNom(e.target.value)} style={inputStyle} placeholder="Mohammed Alaoui" /></div>
            <div><label style={fieldLabel}>Téléphone *</label><input value={tel} onChange={e=>setTel(e.target.value)} style={inputStyle} placeholder="+212 6XX XXX XXX" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div><label style={fieldLabel}>Ville *</label><input value={ville} onChange={e=>setVille(e.target.value)} style={inputStyle} placeholder="Casablanca" /></div>
            <div><label style={fieldLabel}>Besoin *</label><input value={besoin} onChange={e=>setBesoin(e.target.value)} style={inputStyle} placeholder="T3, T4..." /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div><label style={fieldLabel}>Horaire</label><input value={horaire} onChange={e=>setHoraire(e.target.value)} style={inputStyle} placeholder="Matin, Soir..." /></div>
            <div><label style={fieldLabel}>Commercial</label><select value={assigneId} onChange={e=>setAssigneId(e.target.value)} style={{...inputStyle,cursor:'pointer'}}>{commerciaux.map(c=><option key={c.id} value={c.id}>{c.nom}</option>)}</select></div>
          </div>
          <div><label style={fieldLabel}>Notes</label><textarea value={notes} onChange={e=>setNotes(e.target.value)} style={{...inputStyle,minHeight:'70px',resize:'vertical'}} placeholder="Informations complémentaires..." /></div>
        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={btnOutline}>Annuler</button>
          <button onClick={save} disabled={saving||!nom||!tel} style={{...btnPrimary,opacity:!nom||!tel?0.5:1}}>{saving?'Enregistrement...':'💾 Enregistrer'}</button>
        </div>
      </div>
    </div>
  )
}

// Styles partagés
const overlay: any = { position: 'fixed', inset: 0, background: 'rgba(10,26,38,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, backdropFilter: 'blur(4px)', padding: '20px' }
const modal: any = { background: 'white', borderRadius: '16px', width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.2)', animation: 'slideUp 0.25s ease', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }
const modalHeader: any = { padding: '20px 22px 16px', borderBottom: '1px solid rgba(26,58,74,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }
const modalTitle: any = { fontFamily: 'Cormorant Garamond,serif', fontSize: '20px', fontWeight: 600, color: '#1a3a4a' }
const modalFooter: any = { padding: '14px 22px', borderTop: '1px solid rgba(26,58,74,0.1)', display: 'flex', gap: '10px', justifyContent: 'flex-end', background: '#f5f0e8', borderRadius: '0 0 16px 16px' }
const closeBtn: any = { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#9a9a9a', lineHeight: 1 }
const btnBase: any = { display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '8px', fontFamily: 'Outfit,sans-serif', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.15s', whiteSpace: 'nowrap' }
const btnPrimary: any = { ...btnBase, background: '#1a3a4a', color: 'white', padding: '9px 18px' }
const btnOutline: any = { ...btnBase, background: 'white', color: '#5a5a5a', border: '1.5px solid rgba(26,58,74,0.15)', padding: '9px 18px' }
const selStyle: any = { background: 'white', border: '1.5px solid rgba(26,58,74,0.12)', borderRadius: '9px', padding: '9px 12px', fontFamily: 'Outfit,sans-serif', fontSize: '13px', color: '#5a5a5a', cursor: 'pointer', outline: 'none' }
const fieldLabel: any = { display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#9a9a9a', marginBottom: '5px' }
const inputStyle: any = { width: '100%', padding: '10px 12px', border: '1.5px solid rgba(26,58,74,0.12)', borderRadius: '8px', fontFamily: 'Outfit,sans-serif', fontSize: '13px', color: '#1a1a1a', outline: 'none' }
