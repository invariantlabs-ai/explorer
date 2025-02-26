import React, { useEffect } from "react";
import { useUserInfo } from "../../utils/UserInfo";
import { BsGlobe, BsDatabase, BsJustify } from "react-icons/bs";
import { Link, useNavigate } from "react-router-dom";
import { Modal } from "../../components/Modal";
import { Time } from "../../components/Time";
import { useDatasetList } from "../../service/DatasetOperations";
import { UploadDatasetModalContent } from "./NewDataset";
import { DatasetLinkList } from "../user/DatasetList";
import HomepageDatasetsNames from "../../assets/HomepageDatasetsNames.json";
import UserIcon from "../../lib/UserIcon";

import "./Home.scss";
import { CompactSnippetList } from "../snippets/Snippets";
import HomePageNUX from "./NUX";
import { config } from "../../utils/Config";

// fetches user activity from backend
function useActivity(): [any[], () => void] {
  const [activity, setActivity] = React.useState<any[]>([]);

  const refresh = () => {
    fetch("/api/v1/user/events").then((response) => {
      if (response.ok) {
        response.json().then((data) => {
          setActivity(data);
        });
      }
    });
  };

  React.useEffect(() => refresh(), []);

  return [activity, refresh];
}

function FeaturedDatasets(props) {
  const datasets = (props.datasets || []).map((item) => ({
    ...item,
    nice_name: item.nice_name || item.name,
  }));

  return (
    <div>
      {props.datasets === null ? (
        <div className="featured-dataset-empty">Loading Datasets...</div>
      ) : (
        <div className="featured-dataset-list">
          {datasets.map((dataset, i) => (
            <div
              key={i}
              className={`featured-dataset-item ${
                i === datasets.length - 1 ? "last-item" : ""
              }`}
            >
              <div className="featured-dataset-info">
                <Link
                  className="item"
                  to={`/u/${dataset.user.username}/${dataset.name}/t`}
                >
                  <h3>
                    <BsGlobe /> {dataset.nice_name}
                  </h3>
                </Link>
              </div>
              <div className="featured-dataset-description">
                {dataset.description}
              </div>
            </div>
          ))}
        </div>
      )}
      {props.datasets !== null && datasets.length === 0 && (
        <div className="featured-dataset-empty">No Datasets available</div>
      )}
    </div>
  );
}

/**
 * Home screen compopnents, including user's datasets and snippets, public datasets, and user activity.
 */
function Home() {
  const userInfo = useUserInfo();

  // fetch datasets and snippets
  let [featuredDatasets, refreshFeaturedDatasets] = useDatasetList(
    "homepage",
    8,
  );

  useEffect(() => {
    refreshFeaturedDatasets();
  }, [refreshFeaturedDatasets]);

  const [featuredDatasetsTransformed, setFeaturedDatasetsTransformed] =
    React.useState<any[] | null>(null);
  useEffect(() => {
    if (featuredDatasets !== null) {
      const transformed = featuredDatasets.map((item) => ({
        ...item,
        ...(HomepageDatasetsNames["name"][item.id] && {
          nice_name: HomepageDatasetsNames["name"][item.id],
        }),
        ...(HomepageDatasetsNames["description"][item.id] && {
          description: HomepageDatasetsNames["description"][item.id],
        }),
      }));

      transformed.sort((a, b) => {
        const nameA = a.nice_name || "";
        const nameB = b.nice_name || "";
        return nameA.localeCompare(nameB);
      });

      setFeaturedDatasetsTransformed(transformed);
    }
  }, [featuredDatasets]);

  const [privateDatasets, refreshPrivateDatasets] = useDatasetList(
    "private",
    8,
  );

  useEffect(() => {
    if (userInfo?.loggedIn) {
      refreshPrivateDatasets();
    }
  }, [userInfo?.loggedIn, refreshPrivateDatasets]);

  // tracks whether the Upload Dataset modal is open
  const [showUploadModal, setShowUploadModal] = React.useState(false);
  // fetch user activity
  const [activity, refreshActivity] = useActivity();
  // used to navigate to a new page
  const navigate = useNavigate();

  return (
    <>
      {/* upload modal */}
      {showUploadModal && (
        <Modal
          title="Create Dataset"
          onClose={() => setShowUploadModal(false)}
          hasWindowControls
        >
          <UploadDatasetModalContent
            onClose={() => setShowUploadModal(false)}
            onSuccess={refreshPrivateDatasets}
          />
        </Modal>
      )}
      <h2 className="home">Home</h2>
      <div className="home-banner">
        <div className="home-banner-content">
          <h2>Explorer helps you understand your AI agents</h2>
          <p>Learn More about using Explorer for AI agent debugging.</p>
        </div>
        <div className="home-banner-buttons">
          <button
            className="home-banner-button"
            onClick={() =>
              (window.location.href = "https://explorer.invariantlabs.ai/docs/")
            }
          >
            Learn More →
          </button>
          <button
            className="home-banner-button"
            onClick={() =>
              (window.location.href = "https://discord.gg/dZuZfhKnJ4")
            }
          >
            Join the Discord →
          </button>
        </div>
      </div>
      {/* user-personal snippets and datasets */}
      {userInfo?.loggedIn && (
        <div className="mosaic">
          <div className="box dataset split-view">
            <h2>
              <Link to={`/u/${userInfo.username}`}>Datasets</Link>
              <button
                className="inline primary"
                onClick={() => setShowUploadModal(true)}
              >
                New Dataset
              </button>
            </h2>
            <DatasetLinkList datasets={privateDatasets} icon={<BsDatabase />} />
          </div>
          <div className="box split-view">
            <h2>
              <Link to="/snippets">Snippets</Link>
              <button
                className="inline primary"
                onClick={() => navigate("/new")}
              >
                New Trace
              </button>
            </h2>
            <CompactSnippetList icon={<BsJustify />} limit={8} />
          </div>
        </div>
      )}
      {/* public datasets */}
      {config("instance_name") != "local" && (
        <div className="box featureddataset">
          <h2>
            <a href="https://explorer.invariantlabs.ai/benchmarks/">
              Featured Datasets
            </a>
          </h2>
          <FeaturedDatasets
            datasets={featuredDatasetsTransformed}
            icon={<BsGlobe />}
          />
        </div>
      )}
      {/* user activity */}
      {activity.length > 0 && (
        <ul className="box activity">
          <h2>Activity</h2>
          {activity.map((event, i) => (
            <div
              className="item"
              onClick={() =>
                navigate(
                  {
                    dataset:
                      "/u/" + event.user.username + "/" + event.details.name,
                    trace: "/trace/" + event.details.id,
                    annotation: "/trace/" + event.details?.trace?.id,
                  }[event.type],
                )
              }
              key={i}
            >
              <li className="event">
                <div className="event-info">
                  <div className="user">
                    <UserIcon username={event.user.username} size={40} />
                    <div className="left">
                      <div>
                        <Link to={`/u/${event.user.username}`}>
                          <b>{event.user.username}</b>
                        </Link>{" "}
                        {event.text}
                      </div>
                      <div className="event-time">
                        <Time text={true}>{event.time}</Time>
                      </div>
                    </div>
                  </div>
                </div>
                <ActivityDetail event={event} />
              </li>
            </div>
          ))}
          {activity.length === 0 && <div className="empty">No activity</div>}
        </ul>
      )}
      <HomePageNUX />
    </>
  );
}

// Shows details specific to the type of event
function ActivityDetail(props) {
  const event = props.event;

  if (event.type == "dataset") {
    return (
      <div className="event-detail">
        <b>
          <BsDatabase /> {event.details.name}
        </b>
      </div>
    );
  } else if (event.type == "trace") {
    return (
      <div className="event-detail">
        <b>
          <BsJustify /> {event.details.id}
        </b>
      </div>
    );
  } else if (event.type == "annotation") {
    return (
      <div className="event-detail">
        In <em style={{ fontFamily: "monospace" }}>{event.details.id}</em>
        <div className="content">{event.details.content}</div>
      </div>
    );
  } else {
    return null; // unknown event type
  }
}

export default Home;
