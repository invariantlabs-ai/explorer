import React, { useState, useEffect } from 'react'
import { useUserInfo } from './UserInfo'

export function Settings() {
    const userInfo = useUserInfo()

    return <div className="panel entity-list">
        <header>
            <h1>
                Settings
            </h1>
            <div className="spacer" />
            <div className="actions">

            </div>
        </header>
        <p>
            Manage your account settings for {userInfo?.name}
        </p>
    </div>
}