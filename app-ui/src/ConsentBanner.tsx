import { useState } from "react";
import { BsPersonFillLock } from "react-icons/bs";
import { useUserInfo } from "./UserInfo";
import { SUPPORTS_TELEMETRY, HAS_CONSENT } from "./telemetry";

/**
 * Cookie consent banner for analytics.
 * 
 * This component is only displayed to users who have not signed up. Signed up users will always have consent, 
 * as they will have agreed to the privacy policy and terms of service.
 * 
 * For anonymous users, the banner will display a message about cookies and the option to accept or reject them. 
 * Once they accept, the banner will disappear and the user's consent will be stored in local storage. A button
 * will be displayed to revoke consent.
 */
export function ConsentBanner() {
    const [consent, _setConsent] = useState(window.localStorage.getItem('consent') === 'true');
    const [expanded, setExpanded] = useState(false);
    const userInfo = useUserInfo();
    
    function setConsent(consent: boolean) {
        window.localStorage.setItem('consent', consent ? 'true' : 'false');
        window.location.reload();
    }

    if (userInfo?.signedUp || userInfo === null) {
        return null;
    }
    
    if (consent) {
        return null; // we'll show a 'Cookie Controls' link in the site sidebar footer
    }

    return <div className='consent-banner'>
        <p>
            We use cookies for analytics to understand usage of our site using <em><a href='https://posthog.com'>PostHog</a></em>.
        </p>
        {!expanded && <pre className='highlight' onClick={() => setExpanded(true)}>Learn more about our cookies &gt;</pre>}
        {expanded && <pre>
            We collect usage data to:

            <ul>
                <li>Analyze visitor behavior on our website</li>
                <li>Identify areas for improvement and optimize content</li>
                <li>Ensure site security and functionality</li>
            </ul>
            
            Your Consent Options:
            <ul>
                <li>Freely given: Your consent to our cookies is optional, and you are free to use our site without cookies by not clicking "Accept".</li>
                <li>Informed choice: For analytics with PostHog, your data is anonymized where possible and used solely for product improvement.</li>
                <li>Withdraw: You may withdraw or modify your consent at any time by clicking the Cookie Controls link in the sidebar of our site.</li>
            </ul>
            
            Special conditions for children under 13: Consent must be given by a parent or guardian.
            
            We keep a record of your consent. For details on how we handle data, please view our full <a target="_blank" rel="noreferrer" href="/policy">privacy policy</a>.
            </pre>}
        <p>
            By clicking "Accept", you consent to the use of cookies.
            <button className='primary' onClick={() => setConsent(true)}>Accept</button>
        </p>
    </div>;
}

export function RevokeConsent() {
    const userInfo = useUserInfo();

    const onRevoke = () => {
        window.localStorage.clear();
        window.location.reload();
    }

    if (userInfo?.signedUp || userInfo === null || !HAS_CONSENT) {
        return null;
    }

    return <a className='revoke-consent' onClick={onRevoke} 
        data-tooltip-content={'Revokes Your Cookie Consent'}
        data-tooltip-id='button-tooltip'>Cookie Controls</a>;
}