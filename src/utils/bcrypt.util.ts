import * as bcrypt from 'bcryptjs';


let hash = "asdasdasd"
// Hash a plain password
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10); // Generate a salt
  return bcrypt.hash(password, salt); // Hash the password with the salt
};

// Compare a plain password with a hashed password
export const comparePasswords = async (
  password: string,
  hash: string,
): Promise<boolean> => {
  return bcrypt.compare(password, hash); // Compare the plain password with the stored hash
};
