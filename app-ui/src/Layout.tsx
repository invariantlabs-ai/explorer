import React from 'react';
import logo from './assets/invariant.svg';
import { useUserInfo } from './UserInfo';
import { useNavigate } from 'react-router-dom';


function Layout(props: {children: React.ReactNode, fullscreen?: boolean}) {
    const userInfo = useUserInfo();
    const [userPopoverVisible, setUserPopoverVisible] = React.useState(false);
    const navigate = useNavigate();

    return <>
        <header className='top'>
            <img src={logo} alt='Invariant logo' className='logo' onClick={() => navigate('/')}/>
            <h1 onClick={() => navigate('/')} className='title' title='Invariant Explorer'>Invariant Explorer</h1>
            <div className='spacer'/>
            {!userInfo?.loggedIn && <button className='inline' onClick={() => window.location.href = '/login'}>Sign In</button>}
            <div className={'user-info ' + (userPopoverVisible ? 'open' : '')} onClick={() => setUserPopoverVisible(!userPopoverVisible)}>
                {userInfo?.loggedIn && <>
                <div className='avatar'/>
                {userInfo ? <p>{userInfo?.name}</p> : <p>Loading...</p>}
                <div className='popover'>
                    <ul>
                        <li className='disabled'>{userInfo?.email}</li>
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