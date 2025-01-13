import * as jwt from 'jsonwebtoken';

export const getJwtToken = async () => {
  // Ensure the private key is loaded correctly from the environment
  const privateKey = process.env.GITHUB_PEM_KEY;

  // Define the current time and expiration time (10 minutes from now)
  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  const expiration = now + 60; // 10 minutes (600 seconds)

  const payload = {
    iss: process.env.GITHUB_APP_ID, // Replace with your GitHub App ID
    iat: now, // Issued at
    exp: expiration, // Expiration time
  };

  // Sign the JWT using the private key and RS256 algorithm
  const jwtToken = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
  return jwtToken;
};
