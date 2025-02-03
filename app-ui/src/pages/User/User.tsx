import React, { useEffect } from "react";
import { useLoaderData } from "react-router-dom";

import { useUserInfo } from "../../UserInfo";
import { useDatasetList } from "../../lib/DatasetOperations";
import { isClientError, UserNotFound } from "../NotFound/NotFound";
import { DatasetLinkList } from "./DatasetList";

/**
 * Component for displaying a user's public datasets, i.e. the user's profile page.
 */
function User() {
  // get selected user from loader data (populated by site router)
  const props: any = useLoaderData();
  const username = props.username;

  const userInfo = useUserInfo();

  // fetch public datasets for user
  const [publicDatasets, error] = usePublicDatasetList();

  // fetch all datasets if user is logged in
  const [allDatasets, fetchDatasets] = useDatasetList("private");

  useEffect(() => {
    if (userInfo?.loggedIn) {
      fetchDatasets();
    }
  }, [userInfo?.loggedIn, fetchDatasets]);

  if (error) {
    if (isClientError(error.status)) {
      return UserNotFound({ username });
    } else {
      return (
        <div className="empty">
          <p>Error loading user.</p>
        </div>
      );
    }
  }
  return (
    <div className="panel entity-list">
      <header>
        <h1>User: {username}</h1>
        <div className="spacer" />
        <div className="actions"></div>
      </header>
      {userInfo?.loggedIn && userInfo?.username === username ? (
        <div>
          <h3>Your Datasets</h3>
          <DatasetLinkList datasets={allDatasets} />
        </div>
      ) : (
        <div>
          <h3>Public Datasets</h3>
          <DatasetLinkList datasets={publicDatasets} />
        </div>
      )}
    </div>
  );
}

// fetches list of public datasets for a user
function usePublicDatasetList(): [any[] | null, Response | null] {
  const props: any = useLoaderData();
  const username = props.username;
  const [datasets, setDatasets] = React.useState<any[] | null>(null);
  const [error, setError] = React.useState(null as Response | null);

  const refresh = (username) => {
    fetch("/api/v1/dataset/list/byuser/" + username).then((response) => {
      if (response.status !== 200) {
        setError(response);
      } else {
        response.json().then((data) => {
          setDatasets(data);
        });
      }
    });
  };

  React.useEffect(() => refresh(username), [username]);

  return [datasets, error];
}

export default User;
