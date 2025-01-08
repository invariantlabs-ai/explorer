import React from "react";

function isAlphabet(word: string): boolean {
  const char = word.charCodeAt(0);
  return (char >= 65 && char <= 90) || (char >= 97 && char <= 122);
}

// Generate initials from a username.
// Rules from Github:
// Usernames must consist of alphanumeric characters and hyphens.
// Hyphens cannot appear at the beginning or end of the username.
// The first character must be a letter (a–z, A–Z).
const getInitials = (username: string) => {
  if (!username) return "";
  const words = username.trim().split("-");
  return words.length > 1 && isAlphabet(words[words.length - 1])
    ? words[0][0].toUpperCase() + words[words.length - 1][0].toUpperCase()
    : words[0][0].toUpperCase();
};

const UserIcon = ({ username, size = 30 }) => {
  const initials = getInitials(username);
  return (
    <div
      className="user-icon"
      style={
        {
          "--size": `${size}pt`,
        } as React.CSSProperties
      }
    >
      {initials}
    </div>
  );
};

export default UserIcon;
