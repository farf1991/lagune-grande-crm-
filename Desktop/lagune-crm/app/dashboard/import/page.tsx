'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

type LeadRow = { nom: string; tel: string; ville: string; besoin: string; horaire: string; assigneId: string }
type DupRow = { nom: string; tel: string; existingNom: string; existingStatut: string }
type MissingFieldRow = { nom: string; tel: string; ligne: number; champs: string[] }
type InvalidTelRow = { nom: string; tel: string; ligne: number }

function normalizeTel(raw: string): string | null {
  let t = raw.replace(/[^\d+]/g, '')
  // Retirer le + s'il existe pour normaliser
  if (t.startsWith('+')) t = t.slice(1)
  // Corriger les 0 parasites après indicatif connu : 330... → 33..., 2120... → 212...
  if (t.startsWith('330')) t = '33' + t.slice(3)
  else if (t.startsWith('2120')) t = '212' + t.slice(4)
  // Valider : uniquement des chiffres, longueur entre 8 et 15
  if (!/^[0-9]{8,15}$/.test(t)) return null
  return '+' + t
}

export default function ImportPage() {
  const router = useRouter()
  const supabase = createClientComponentClient()

  const [status, setStatus] = useState<'idle' | 'preview' | 'importing' | 'done'>('idle')
  const [dragOver, setDragOver] = useState(false)
  const [profiles, setProfiles] = useState<any[]>([])
  const [newLeads, setNewLeads] = useState<LeadRow[]>([])
  const [duplicates, setDuplicates] = useState<DupRow[]>([])
  const [showDups, setShowDups] = useState(false)
  const [bulkAssigne, setBulkAssigne] = useState('')
  const [result, setResult] = useState({ imported: 0, skipped: 0 })
  const [missingFields, setMissingFields] = useState<MissingFieldRow[]>([])
  const [fieldError, setFieldError] = useState(false)
  const [invalidTels, setInvalidTels] = useState<InvalidTelRow[]>([])
  const [telError, setTelError] = useState(false)

  const loadProfiles = async () => {
    const { data } = await supabase.from('profiles').select('*').eq('role', 'commercial').eq('actif', true)
    return data || []
  }

  const handleFile = async (file: File) => {
    const profs = await loadProfiles()
    setProfiles(profs)
    const defaultId = profs[0]?.id || ''

    const XLSX = await import('xlsx')
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })
    if (data.length < 2) return

    const hdrs = data[0].map((h: any) => String(h).trim().toLowerCase())
    const dataRows = data.slice(1).filter((r: any[]) => r.some(c => c))

    const fieldMap: Record<string, string[]> = {
      nom: ['nom', 'name', 'prénom', 'prenom', 'client'],
      tel: ['tel', 'téléphone', 'telephone', 'phone', 'mobile', 'gsm'],
      ville: ['ville', 'city', 'localité', 'localite', 'commune'],
      besoin: ['besoin', 'budget', 'prix', 'price', 'projet'],
      horaire: ['horaire', 'créneau', 'creneau', 'heure', 'disponibilité', 'disponibilite'],
    }
    const mp: Record<string, number> = {}
    Object.entries(fieldMap).forEach(([field, syns]) => {
      const idx = hdrs.findIndex(h => syns.some(s => h.includes(s)))
      if (idx >= 0) mp[field] = idx
    })

    const { data: existingLeads } = await supabase.from('leads').select('tel, nom, statut')
    const existingMap = new Map((existingLeads || []).map((l: any) => [l.tel.trim(), l]))

    const newRows: LeadRow[] = []
    const dupRows: DupRow[] = []
    const missingFieldRows: MissingFieldRow[] = []
    const invalidTelRows: InvalidTelRow[] = []

    dataRows.forEach((row, idx) => {
      const tel = mp.tel !== undefined ? String(row[mp.tel] || '').trim() : ''
      if (!tel) return
      const nom = mp.nom !== undefined ? String(row[mp.nom] || '').trim() : 'Inconnu'
      const ville = mp.ville !== undefined ? String(row[mp.ville] || '').trim() : ''
      const besoin = mp.besoin !== undefined ? String(row[mp.besoin] || '').trim() : ''
      const horaire = mp.horaire !== undefined ? String(row[mp.horaire] || '').trim() : ''

      // Normalisation + validation téléphone
      const telNormalisé = normalizeTel(tel)
      if (!telNormalisé) {
        invalidTelRows.push({ nom, tel, ligne: idx + 2 })
        return
      }

      const manquants: string[] = []
      if (!nom) manquants.push('Nom')
      if (!ville) manquants.push('Ville')
      if (!besoin) manquants.push('Besoin')
      if (!horaire) manquants.push('Horaire')

      if (manquants.length > 0) {
        missingFieldRows.push({ nom: nom || '—', tel, ligne: idx + 2, champs: manquants })
        return
      }

      const existing = existingMap.get(telNormalisé)
      if (existing) {
        dupRows.push({ nom, tel: telNormalisé, existingNom: existing.nom, existingStatut: existing.statut })
      } else {
        newRows.push({ nom, tel: telNormalisé, ville, besoin, horaire, assigneId: defaultId })
      }
    })

    // Bloquer si téléphones invalides
    if (invalidTelRows.length > 0) {
      setInvalidTels(invalidTelRows)
      setTelError(true)
      setStatus('preview')
      return
    }

    // Bloquer si champs manquants
    if (missingFieldRows.length > 0) {
      setMissingFields(missingFieldRows)
      setFieldError(true)
      setStatus('preview')
      return
    }

    setInvalidTels([])
    setTelError(false)
    setMissingFields([])
    setFieldError(false)
    setNewLeads(newRows)
    setDuplicates(dupRows)
    setBulkAssigne('')
    setStatus('preview')
  }

  const applyBulkAssigne = (id: string) => {
    setBulkAssigne(id)
    setNewLeads(prev => prev.map(l => ({ ...l, assigneId: id })))
  }

  const updateAssigne = (idx: number, id: string) => {
    setNewLeads(prev => prev.map((l, i) => i === idx ? { ...l, assigneId: id } : l))
  }

  const doImport = async () => {
    setStatus('importing')
    const { data: { session } } = await supabase.auth.getSession()
    let imported = 0

    const batch = newLeads.map(l => ({
      nom: l.nom, tel: l.tel, ville: l.ville, source: 'Meta',
      besoin: l.besoin, horaire: l.horaire, assigne_id: l.assigneId,
      statut: 'Nouveau', projet: 'Lagune Grande Sidi Rahal',
    }))

    let insertError = ''
    for (let i = 0; i < batch.length; i += 100) {
      const chunk = batch.slice(i, i + 100)
      const { data: inserted, error } = await supabase.from('leads').insert(chunk).select('id')
      if (error) { insertError = error.message; break }
      if (inserted) {
        imported += inserted.length
        const logs = inserted.map((l: any) => ({ lead_id: l.id, auteur_id: session?.user.id, action: 'Lead importé via Excel', note: '' }))
        await supabase.from('lead_logs').insert(logs)
      }
    }

    if (insertError) {
      alert('Erreur import : ' + insertError)
      setStatus('preview')
      return
    }

    setResult({ imported, skipped: duplicates.length })
    setStatus('done')
  }

  const inp: any = { background: 'white', border: '1.5px solid rgba(26,58,74,0.12)', borderRadius: '8px', padding: '7px 10px', fontFamily: 'Outfit,sans-serif', fontSize: '12px', color: '#1a3a4a', cursor: 'pointer' }

  return (
    <div style={{ padding: '24px 28px', fontFamily: 'Outfit,sans-serif', maxWidth: '900px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: '24px', fontWeight: 600, color: '#1a3a4a' }}>Import Excel</h2>
        <p style={{ fontSize: '12px', color: '#9a9a9a' }}>Importez et distribuez vos leads</p>
      </div>

      {/* IDLE */}
      {status === 'idle' && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          onClick={() => document.getElementById('file-input')?.click()}
          style={{ border: `2px dashed ${dragOver ? '#2a7a8a' : 'rgba(26,58,74,0.2)'}`, borderRadius: '14px', padding: '50px', textAlign: 'center', cursor: 'pointer', background: dragOver ? 'rgba(42,122,138,0.04)' : '#f5f0e8', transition: 'all 0.2s' }}
        >
          <input type="file" id="file-input" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          <div style={{ fontSize: '44px', marginBottom: '14px' }}>📊</div>
          <h3 style={{ fontSize: '17px', fontWeight: 600, color: '#1a3a4a', marginBottom: '6px' }}>Glissez votre fichier Excel ici</h3>
          <p style={{ fontSize: '13px', color: '#9a9a9a' }}>ou cliquez pour sélectionner (.xlsx, .xls, .csv)</p>
          <p style={{ fontSize: '12px', color: '#2a7a8a', marginTop: '10px', fontWeight: 500 }}>Colonnes détectées auto : Nom, Téléphone, Email, Source, Budget</p>
        </div>
      )}

      {/* PREVIEW */}
      {status === 'preview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Erreur téléphone invalide */}
          {telError && (
            <div style={{ background: 'rgba(224,90,58,0.06)', border: '2px solid #e05a3a', borderRadius: '12px', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <span style={{ fontSize: '24px' }}>🚫</span>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#e05a3a' }}>Import bloqué — {invalidTels.length} numéro{invalidTels.length > 1 ? 's' : ''} invalide{invalidTels.length > 1 ? 's' : ''}</div>
                  <div style={{ fontSize: '12px', color: '#9a9a9a', marginTop: '2px' }}>Le numéro doit commencer par + avec l&apos;indicatif pays (ex: +212612345678 ou +33612345678)</div>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: 'rgba(224,90,58,0.1)' }}>
                    {['Ligne', 'Nom', 'Numéro invalide'].map(h => (
                      <th key={h} style={{ padding: '7px 12px', textAlign: 'left', color: '#e05a3a', fontWeight: 700, fontSize: '11px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invalidTels.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(224,90,58,0.1)' }}>
                      <td style={{ padding: '7px 12px', fontWeight: 700, color: '#e05a3a' }}>Ligne {r.ligne}</td>
                      <td style={{ padding: '7px 12px', color: '#1a3a4a' }}>{r.nom}</td>
                      <td style={{ padding: '7px 12px', color: '#5a5a5a', fontFamily: 'monospace' }}>{r.tel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => { setStatus('idle'); setTelError(false); setInvalidTels([]) }} style={{ marginTop: '14px', background: '#e05a3a', color: 'white', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Outfit,sans-serif' }}>
                ↩ Réimporter un fichier corrigé
              </button>
            </div>
          )}

          {/* Erreur champs manquants */}
          {fieldError && (
            <div style={{ background: 'rgba(224,90,58,0.06)', border: '2px solid #e05a3a', borderRadius: '12px', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <span style={{ fontSize: '24px' }}>🚫</span>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#e05a3a' }}>Import bloqué — {missingFields.length} lead{missingFields.length > 1 ? 's' : ''} avec champs manquants</div>
                  <div style={{ fontSize: '12px', color: '#9a9a9a', marginTop: '2px' }}>Corrigez votre fichier Excel et réimportez</div>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: 'rgba(224,90,58,0.1)' }}>
                    {['Ligne', 'Nom', 'Téléphone', 'Champs manquants'].map(h => (
                      <th key={h} style={{ padding: '7px 12px', textAlign: 'left', color: '#e05a3a', fontWeight: 700, fontSize: '11px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {missingFields.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(224,90,58,0.1)' }}>
                      <td style={{ padding: '7px 12px', fontWeight: 700, color: '#e05a3a' }}>Ligne {r.ligne}</td>
                      <td style={{ padding: '7px 12px', color: '#1a3a4a' }}>{r.nom}</td>
                      <td style={{ padding: '7px 12px', color: '#5a5a5a' }}>{r.tel}</td>
                      <td style={{ padding: '7px 12px' }}>
                        {r.champs.map(c => <span key={c} style={{ display: 'inline-block', marginRight: '4px', background: 'rgba(224,90,58,0.15)', color: '#e05a3a', borderRadius: '4px', padding: '2px 7px', fontSize: '11px', fontWeight: 600 }}>{c}</span>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => { setStatus('idle'); setFieldError(false); setMissingFields([]) }} style={{ marginTop: '14px', background: '#e05a3a', color: 'white', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Outfit,sans-serif' }}>
                ↩ Réimporter un fichier corrigé
              </button>
            </div>
          )}

          {/* Résumé + Distribution + Actions */}
          {!fieldError && !telError && <><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ background: 'rgba(45,138,94,0.08)', border: '1.5px solid rgba(45,138,94,0.3)', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
              <span style={{ fontSize: '28px' }}>✅</span>
              <div>
                <div style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: '32px', fontWeight: 700, color: '#2d8a5e', lineHeight: 1 }}>{newLeads.length}</div>
                <div style={{ fontSize: '12px', color: '#2d8a5e', fontWeight: 600, marginTop: '2px' }}>Nouveaux leads à importer</div>
              </div>
            </div>
            <div style={{ background: duplicates.length > 0 ? 'rgba(224,90,58,0.08)' : 'rgba(26,58,74,0.04)', border: `1.5px solid ${duplicates.length > 0 ? 'rgba(224,90,58,0.3)' : 'rgba(26,58,74,0.1)'}`, borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
              <span style={{ fontSize: '28px' }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: '32px', fontWeight: 700, color: duplicates.length > 0 ? '#e05a3a' : '#9a9a9a', lineHeight: 1 }}>{duplicates.length}</div>
                <div style={{ fontSize: '12px', color: duplicates.length > 0 ? '#e05a3a' : '#9a9a9a', fontWeight: 600, marginTop: '2px' }}>Doublons ignorés</div>
              </div>
              {duplicates.length > 0 && (
                <button onClick={() => setShowDups(!showDups)} style={{ fontSize: '11px', color: '#e05a3a', background: 'none', border: '1px solid rgba(224,90,58,0.3)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontFamily: 'Outfit,sans-serif', whiteSpace: 'nowrap' }}>
                  {showDups ? 'Masquer' : 'Voir liste'}
                </button>
              )}
            </div>
          </div>

          {/* Liste doublons */}
          {showDups && duplicates.length > 0 && (
            <div style={{ background: 'white', borderRadius: '12px', border: '1.5px solid rgba(224,90,58,0.2)', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', background: 'rgba(224,90,58,0.06)', borderBottom: '1px solid rgba(224,90,58,0.15)', fontSize: '12px', fontWeight: 700, color: '#e05a3a' }}>
                ⚠️ Ces {duplicates.length} leads existent déjà — ils ne seront pas réimportés
              </div>
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f5f0e8' }}>
                      {['Nom fichier', 'Téléphone', 'Déjà enregistré sous', 'Statut actuel'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#9a9a9a', fontWeight: 600, fontSize: '11px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {duplicates.map((d, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(26,58,74,0.06)' }}>
                        <td style={{ padding: '8px 12px', color: '#1a3a4a', fontWeight: 500 }}>{d.nom}</td>
                        <td style={{ padding: '8px 12px', color: '#5a5a5a' }}>{d.tel}</td>
                        <td style={{ padding: '8px 12px', color: '#1a3a4a' }}>{d.existingNom}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: '#2a7a8a', background: 'rgba(42,122,138,0.1)', padding: '2px 8px', borderRadius: '8px' }}>{d.existingStatut}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Distribution */}
          {newLeads.length > 0 && (
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid rgba(26,58,74,0.1)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(26,58,74,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a3a4a' }}>Distribution des {newLeads.length} leads</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', color: '#9a9a9a' }}>Tout assigner à :</span>
                  <select value={bulkAssigne} onChange={e => applyBulkAssigne(e.target.value)} style={inp}>
                    <option value="">— choisir —</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f5f0e8', position: 'sticky', top: 0 }}>
                      {['Nom', 'Téléphone', 'Source', 'Budget', 'Assigner à'].map(h => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#9a9a9a', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {newLeads.map((l, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(26,58,74,0.06)' }}>
                        <td style={{ padding: '9px 14px', fontWeight: 600, color: '#1a3a4a' }}>{l.nom}</td>
                        <td style={{ padding: '9px 14px', color: '#5a5a5a' }}>{l.tel}</td>
                        <td style={{ padding: '9px 14px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: '#2a7a8a', background: 'rgba(42,122,138,0.1)', padding: '2px 8px', borderRadius: '8px' }}>Meta</span>
                        </td>
                        <td style={{ padding: '9px 14px' }}>
                          <select value={l.assigneId} onChange={e => updateAssigne(i, e.target.value)} style={inp}>
                            <option value="">— non assigné —</option>
                            {profiles.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={doImport}
              disabled={newLeads.length === 0}
              style={{ background: newLeads.length === 0 ? '#ccc' : '#1a3a4a', color: 'white', border: 'none', borderRadius: '9px', padding: '12px 24px', fontSize: '14px', fontWeight: 600, cursor: newLeads.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'Outfit,sans-serif' }}
            >
              ✅ Importer {newLeads.length} leads
            </button>
            <button onClick={() => setStatus('idle')} style={{ background: 'white', color: '#5a5a5a', border: '1.5px solid rgba(26,58,74,0.12)', borderRadius: '9px', padding: '12px 18px', fontSize: '14px', cursor: 'pointer', fontFamily: 'Outfit,sans-serif' }}>
              Annuler
            </button>
          </div></>}
        </div>
      )}

      {/* IMPORTING */}
      {status === 'importing' && (
        <div style={{ background: 'white', borderRadius: '14px', padding: '50px', textAlign: 'center', border: '1px solid rgba(26,58,74,0.1)' }}>
          <div style={{ fontSize: '40px', marginBottom: '14px' }}>⏳</div>
          <h3 style={{ color: '#1a3a4a', fontSize: '16px', fontWeight: 600 }}>Import en cours...</h3>
          <p style={{ color: '#9a9a9a', fontSize: '13px', marginTop: '6px' }}>Ne fermez pas cette page</p>
        </div>
      )}

      {/* DONE */}
      {status === 'done' && (
        <div style={{ background: 'white', borderRadius: '14px', padding: '50px', textAlign: 'center', border: '1px solid rgba(26,58,74,0.1)' }}>
          <div style={{ fontSize: '44px', marginBottom: '14px' }}>✅</div>
          <h3 style={{ color: '#2d8a5e', fontSize: '22px', fontWeight: 700 }}>{result.imported} leads importés !</h3>
          {result.skipped > 0 && (
            <p style={{ color: '#e05a3a', fontSize: '13px', marginTop: '8px', fontWeight: 500 }}>⚠️ {result.skipped} doublons ignorés</p>
          )}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '24px' }}>
            <button onClick={() => router.push('/dashboard/leads')} style={{ background: '#1a3a4a', color: 'white', border: 'none', borderRadius: '9px', padding: '11px 22px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Outfit,sans-serif' }}>
              Voir les leads
            </button>
            <button onClick={() => { setStatus('idle'); setNewLeads([]); setDuplicates([]) }} style={{ background: 'white', color: '#5a5a5a', border: '1.5px solid rgba(26,58,74,0.12)', borderRadius: '9px', padding: '11px 18px', fontSize: '14px', cursor: 'pointer', fontFamily: 'Outfit,sans-serif' }}>
              Nouvel import
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
