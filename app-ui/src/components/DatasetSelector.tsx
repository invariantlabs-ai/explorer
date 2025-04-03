import React, { useEffect, useState, useRef } from "react";
import { useUserInfo } from "../utils/UserInfo";
import { BsDatabase } from "react-icons/bs";
import "./DatasetSelector.scss";
import { useDatasetList } from "../service/DatasetOperations";
import { useDebounce } from "use-debounce"; // add this package

export function DatasetSelector(props: {
  onSelect: (datasetName: string) => void;
  initialDatasetName?: string;
}) {
  const [selectedDatasetName, setSelectedDatasetName] = useState(
    props.initialDatasetName || ""
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const userInfo = useUserInfo();
  const [debouncedSearchTerm] = useDebounce(searchTerm, 500); // delay in ms

  const [privateDatasets, refreshPrivateDatasets] = useDatasetList(
    "private",
    64,
    debouncedSearchTerm
  );

  const isLoading = searchTerm != debouncedSearchTerm;

  useEffect(() => {
    if (userInfo?.loggedIn) {
      refreshPrivateDatasets();
    }
  }, [userInfo?.loggedIn, refreshPrivateDatasets]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      if (userInfo?.loggedIn) refreshPrivateDatasets();
    }, 200);
    return () => clearTimeout(delayDebounce);
  }, [searchTerm]);

  return (
    <div className="custom-select-container" ref={containerRef}>
      <div
        className="custom-select-input"
        onClick={() => setDropdownOpen(!dropdownOpen)}
      >
        <BsDatabase />
        {selectedDatasetName}{" "}
      </div>
      {dropdownOpen && (
        <div className="custom-select-dropdown">
          {isLoading && <span className="loading">Loading...</span>}
          <input
            className="custom-select-search"
            type="text"
            placeholder="Search datasets..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setHighlightedIndex(0);
            }}
            autoFocus
            ref={searchInputRef}
          />
          <div className="custom-select-items">
            {(privateDatasets || []).map((dataset, index) => {
              const datasetName = dataset.name;
              return (
                <div
                  key={datasetName}
                  className={`custom-select-item ${
                    selectedDatasetName === datasetName ? " selected" : ""
                  }${index === highlightedIndex ? " highlighted" : ""}`}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => {
                    setSelectedDatasetName(datasetName);
                    props.onSelect(datasetName);
                    setDropdownOpen(false);
                    setSearchTerm("");
                  }}
                >
                  <BsDatabase />
                  {datasetName}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
