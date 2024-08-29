import React, { useState, useEffect, useCallback } from 'react'
import { EntityList } from './EntityList';
import { useUserInfo } from './UserInfo';
import { BsTrash, BsUpload, BsX } from 'react-icons/bs';
import { Link, useNavigate } from 'react-router-dom';
import { Time } from './components/Time';
import { DeleteSnippetModal, useSnippetsList } from './lib/snippets';


export function Snippets() {
    const [snippets, refreshSnippets] = useSnippetsList()
    const [selectedSnippetForDelete, setSelectedSnippetForDelete] = React.useState(null)
    
    const userInfo = useUserInfo()
    const navigate = useNavigate()

    return <>
        {/* delete snippet modal */}
        {selectedSnippetForDelete && <DeleteSnippetModal snippet={selectedSnippetForDelete} setSnippet={setSelectedSnippetForDelete} onSuccess={refreshSnippets}/>}
        
        <EntityList title="Snippets" actions={<>
            {userInfo?.loggedIn && <button className='primary' onClick={() => navigate('/new')}>
                            <BsUpload/>
                            Upload Trace
                            </button>}
            </>}>
            {snippets.map((snippet, i) => <Link className='item' to={`/trace/${snippet.id}`} key={i}><li>
                <h3>Snippet <span className='traceid'>#{snippet.id.slice(0, 6)}</span></h3>
                <span className='description'>
                <Time>{snippet.time_created}</Time>
                </span>
                <div className='spacer'/>
            </li></Link>)}
            {snippets.length === 0 && <div className='empty'>No snippets</div>}
        </EntityList>
    </>
}

export function CompactSnippetList(props) {
    const [snippets, refreshSnippets] = useSnippetsList(props.limit || null);

    return <>
        <EntityList>
            {snippets.map((snippet, i) => <Link className='item' to={`/trace/${snippet.id}`} key={i}><li>
                <h3>{props.icon} Snippet <span className='traceid'>#{snippet.id.slice(0, 6)}</span></h3>
                <span className='description'>
                <Time>{snippet.time_created}</Time>
                </span>
            </li></Link>)}
            {snippets.length === 0 && <div className='empty'>No snippets</div>}
        </EntityList>
    </>
}