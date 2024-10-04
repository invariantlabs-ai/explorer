import React, { useState, useEffect } from 'react'
import { useUserInfo } from './UserInfo'
import { BsKey, BsTrash } from 'react-icons/bs'
import { sharedFetch } from './SharedFetch'
import { Modal } from './Modal'

// fetch the user's API keys from the server
const useApiKeys = () => {
    const [apiKeys, setApiKeys] = useState<string[]>([])
    useEffect(() => {
        refresh()
    }, [])

    const refresh = () => {
        sharedFetch('/api/v1/keys/list').then((data) => {
            setApiKeys(data.keys)
        })
    }

    return [apiKeys, refresh] as const
}

// modal content to show when creating a new API key
function NewAPIKeyModal({ apiKey, onClose }) {
    const [justCopied, setJustCopied] = React.useState(false)

    useEffect(() => {
        if (justCopied) {
            let timeout = setTimeout(() => setJustCopied(false), 2000)
            return () => clearTimeout(timeout)
        }
    }, [justCopied])

    const onClick = (e) => {
        e.currentTarget.select()
        navigator.clipboard.writeText(e.currentTarget.value)
        setJustCopied(true)
    }

    return <div className='form' style={{ maxWidth: '500pt' }}>
        {/* <h2>By sharing a trace you can allow others to view the trace and its annotations. Anyone with the generated link will be able to view the trace.</h2> */}
        <h2>Use the API Key below to access the API.</h2>
        <h2>After closing this dialog, you will not be able to see the key again.</h2>
        <input type='text' value={apiKey} className='link' onClick={onClick} disabled={false} style={{ fontSize: "10pt" }} readOnly />
        <span className='description' style={{ color: justCopied ? 'inherit' : 'transparent' }}>{justCopied ? 'Copied to clipboard!' : 'no'}</span>
        <button onClick={onClose} className='primary'>Close</button>
    </div>
}

/**
 * UI screen for user settings.
 */
export function Settings() {
    const userInfo = useUserInfo()
    const [apiKeys, refresh] = useApiKeys()

    const [createdApiKey, setCreatedApiKey] = useState<string | null>(null)
    const [showExpired, setShowExpired] = useState(false)

    // create a new API key for the current user
    const onCreateAPIKey = async () => {
        try {
            const res = await fetch('/api/v1/keys/create', { method: 'POST' })
            const data = await res.json()
            setCreatedApiKey(data.key)
            refresh()
        } catch (e) {
            alert('Failed to create API key')
        }
    }

    // revoke an existing API key by its ID
    const onRevokeAPIKey = async (id: string) => {
        try {
            const res = await fetch('/api/v1/keys/' + id, { method: 'DELETE' })
            const data = await res.json()
            if (!data.success) {
                alert(data.detail)
            } else {
                refresh()
            }
        } catch (e) {
            alert('Failed to revoke API key')
        }
    }

    // filter out expired keys if the user does not want to see them
    const keys = apiKeys.filter((apikey: any) => showExpired || !apikey.expired);

    return <div className="panel entity-list">
        {createdApiKey && <Modal title="Your API Key" onClose={() => setCreatedApiKey(null)}>
            <NewAPIKeyModal apiKey={createdApiKey} onClose={() => setCreatedApiKey(null)} />
        </Modal>}
        <header>
            <h2 className="home">
                Settings
            </h2>
            <div className="spacer" />
            <div className="actions">
                {/* no actions on top level */}
            </div>
        </header>
        <div className='box'>
            <h2>
                API Keys
                <div className='spacer' />
                <label>Show Expired <input type='checkbox' checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} /></label>
                <button className='inline primary' onClick={() => onCreateAPIKey()}>New API Key</button>
            </h2>
            <table className='data api-keys'>
                <tbody>
                    {keys.map((apikey: any) => <tr className={apikey.expired ? 'expired' : ''} key={apikey.id}>
                        <td><BsKey /> <code>***************{apikey.hashed_key.substr(0, 8)}</code></td>
                        <td>
                            Created on {apikey.time_created}
                        </td>
                        <td className='actions'>
                            <button className='tool' disabled={apikey.expired} onClick={() => onRevokeAPIKey(apikey.id)}><BsTrash /> Revoke</button>
                        </td>
                    </tr>)}
                    {keys.length == 0 && <div className='empty'>
                        No API Keys
                    </div>}
                </tbody>
            </table>
        </div>
    </div>
}