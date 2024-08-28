import React, { useCallback, useEffect } from 'react';
import logo from './assets/invariant.svg';
import { useUserInfo } from './UserInfo';
import { Link, useLoaderData, useNavigate } from 'react-router-dom';
import { BsCodeSlash, BsDatabase, BsFillGearFill, BsGear, BsHouse, BsList, BsUpload, BsX } from 'react-icons/bs';
import { BiSolidHome } from 'react-icons/bi';
import { useDatasetList } from './lib/datasets';
import { useSnippetsList } from './lib/snippets';
import { CompactSnippetList } from './Snippets';
import { DatasetLinkList } from './Datasets';

function useAnimatedClassState(initialState: boolean) {
    // delayed state
    const [state, _setState] = React.useState(initialState);
    // immediate state
    const [immState, setImmState] = React.useState(initialState);

    const setState = useCallback((newState: boolean) => {
        // cannot change state during transition
        if (state !== immState) {
            return;
        }
        if (newState) {
            // setting true is immediate
            setImmState(true);
            setTimeout(() => {
                _setState(true);
            }, 100);
        } else {
            setImmState(false);
            // setting false is delayed to allow for off animation
            setTimeout(() => {
                _setState(false);
            }, 100);
        }
    }, [state, immState]);

    if (state) {
        return [state, immState, setState] as const;
    } else {
        return [immState, state, setState] as const;
    }
}

function Sidebar(props) {
    const [sidebarDomIncluded, sidebarOpen, setSidebarOpen] = useAnimatedClassState(false);
    const userInfo = useUserInfo();
    
    const [datasets, refresh] = useDatasetList();
    const [snippets, refreshSnippets] = useSnippetsList() 
    
    // on open, register escape key listener
    useEffect(() => {
        if (sidebarOpen) {
            const listener = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    setSidebarOpen(false);
                }
            };
            document.addEventListener('keydown', listener);
            return () => document.removeEventListener('keydown', listener);
        }
    }, [sidebarOpen, setSidebarOpen]);
    
    return <>
        <button className='top' onClick={() => setSidebarOpen(!sidebarOpen)}>
            <BsList/>
        </button>
    {sidebarDomIncluded && <div className={"sidebar " + (sidebarOpen ? 'open' : '')}>
        <div className='sidebar-background' onClick={() => setSidebarOpen(false)}/>
        <ul className='sidebar-content' onClick={(e) => setTimeout(() => setSidebarOpen(false), 0)}>
            <button className='top close' onClick={() => setSidebarOpen(false)}>
                <BsX/>
            </button>
            {props.children}
            <h2><Link to='/datasets'>Datasets</Link></h2>
            {props.datasets}
            <DatasetLinkList datasets={(datasets || []).filter((dataset) => dataset.user?.id == userInfo?.id)}/>
            <h2><Link to='/snippets'>Snippets</Link></h2>
            <CompactSnippetList/>
            <h2></h2>
            {/* unicode copyright */}
            <p className='secondary'>&copy; 2024 Invariant Labs</p>
            <p>
                <a href='https://invariantlabs.ai' target='_blank'>About</a>
                <a href='https://github.com/invariantlabs-ai/invariant' target='_blank'>Analyzer</a>
            </p>
        </ul>
    </div>}</>
}

function Layout(props: {children: React.ReactNode, fullscreen?: boolean}) {
    const userInfo = useUserInfo();
    const [userPopoverVisible, setUserPopoverVisible] = React.useState(false);
    const navigate = useNavigate();

    return <>
        <header className='top'>
            <Sidebar>
                <li className='logo'>
                    <h1>
                        <img src={logo} alt='Invariant logo' className='logo'/>
                        Invariant Explorer
                    </h1>
                </li>
                <li><a href='/'>
                    <BsHouse/>
                    Home
                </a></li>
                <li><a href='/datasets'>
                    <BsDatabase/>
                    Datasets
                </a></li>
                <li><a href='/snippets'>
                    <BsCodeSlash/>
                    Snippets
                </a></li>
                <li><a href='/settings'>
                    <BsGear/>
                    Settings
                </a></li>
            </Sidebar>
            <h1 onClick={() => navigate('/')} className='title' title='Invariant Explorer'>
                <img src={logo} alt='Invariant logo' className='logo' onClick={() => navigate('/')}/>
                Invariant Explorer
            </h1>
            <div className='spacer'/>
            {!userInfo?.loggedIn && <button className='inline' onClick={() => window.location.href = '/login'}>Sign In</button>}
            <div className={'user-info ' + (userPopoverVisible ? 'open' : '')} onClick={() => setUserPopoverVisible(!userPopoverVisible)}>
                {userInfo?.loggedIn && <>
                <div className='avatar'>
                    <img src={"https://www.gravatar.com/avatar/" + userInfo?.image_url_hash} />
                </div>
                {userInfo ? <p>{userInfo?.name}</p> : <p>Loading...</p>}
                <div className='popover'>
                    <ul>
                        <li className='disabled'>{userInfo?.email}</li>
                        <li><a href='/settings'>Account</a></li>
                        <li><a href='/logout'>Log Out</a></li>
                    </ul>
                </div>
                </>}
            </div>
        </header>
        <div className={'content ' + (props.fullscreen ? 'fullscreen' : '')}>
        {props.children}
        </div>
    </>;
}

export default Layout;