import "./ToggleButton.scss";

export function ToggleButton({
  toggled,
  setToggled,
  children,
  className,
}: {
  toggled: boolean;
  setToggled: (toggled: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className="toggle-button-container"
      onClick={() => setToggled(!toggled)}
    >
      <div
        className={
          "toggle-button " +
          (toggled ? "toggled" : "") +
          (" " + (className || ""))
        }
      >
        <button
          className={`${toggled ? "toggled" : ""}`}
          onClick={() => setToggled(!toggled)}
        ></button>
      </div>
      <label>{children}</label>
    </div>
  );
}
