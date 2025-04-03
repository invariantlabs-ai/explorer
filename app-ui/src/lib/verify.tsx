import { useUserInfo } from "../utils/UserInfo";
import { config } from "../utils/Config";
import { useNavigate } from "react-router-dom";
import React, { useState, useEffect } from "react";
import { Modal } from './../components/Modal'

const key = 'invariant.explorer.production.apikey'

function useVerify() {
    const userInfo = useUserInfo();
    const isLocal = config('instance_name') === 'local';
    const navigate = useNavigate();
    const [isModalVisible, setIsModalVisible] = useState(false);
    const [apiKey, setApiKey] = useState('');

    useEffect(() => {
        if (isModalVisible) {
            // Reset form when opened
            setApiKey('');
        }
    }, [isModalVisible]);

    const handleSubmit = () => {
        localStorage.setItem(key, apiKey);
        window.location.reload();
        setIsModalVisible(false);
    };

    const verify = async (messages: any, policy: string): Promise<Response> => {
        if (isLocal) {
            // if we are local, use an API key from local storage -- if it is not there, ask the user
            if (!localStorage.getItem(key)?.trim()) {
                // Display a modal to ask for the API key
                setIsModalVisible(true);
                return Promise.reject(new Error('API key required'));
            }

            return fetch("https://explorer.invariantlabs.ai/api/v1/policy/check", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + localStorage.getItem('PRODUCTION_EXPLORER_API_KEY')
                },
                body: JSON.stringify({
                    messages: messages,
                    policy: policy,
                }),
            });
        } else if (userInfo?.signedUp) {
            // If we are not local and the user is signed up
            // Use the session cookies instead for authentication
            // No explicit Authorization header needed if using session cookies

            return fetch("https://explorer.invariantlabs.ai/api/v1/policy/check", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: messages,
                    policy: policy,
                }),
                credentials: 'include'
            });

        } else {
            // If not local, and not signed in, redirect to sign-in
            navigate('/signin')
            return Promise.reject(new Error('Authentication required'));
        }

    };

    // A self-contained ApiKeyModal component
    const ApiKeyModal = () => {
        return (
            <div>
                {isModalVisible && (
                    <Modal
                        title="API Key Required"
                        hasWindowControls={true}
                        hasFooter={false}
                        cancelText="Cancel"
                        onClose={() => setIsModalVisible(false)}
                    >
                    <div className="form">
                        <p>Please enter your Invariant Explorer API key to continue:</p>

                        <input
                            type="text"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                        />

                            <button
                                onClick={handleSubmit}
                                className="primary"
                            >
                                Submit
                            </button>
                    </div>
                    </Modal>
                )}
            </div>
        );
    };

    return { verify, ApiKeyModal };
}

export default useVerify;
