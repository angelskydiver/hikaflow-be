export const unnecessaryFiles = [
  'package-lock.json',
  'yarn.lock',
  'tsconfig.json',
  'jsconfig.json',
  'babel.config.js',
  'package.json',
];

export const excludedExtensions = [
  '.png',
  '.jpeg',
  '.jpg',
  '.gif',
  '.webp',
  '.bmp',
  '.sql',
];

export const shouldAnalyze = (fileName) => {
  // Exclude if the file name is exactly in the list
  if (unnecessaryFiles.includes(fileName)) {
    return false;
  }

  // Exclude if the file extension is in the list
  // Convert to lowercase to be case-insensitive.
  return !excludedExtensions.some((ext) =>
    fileName.toLowerCase().endsWith(ext),
  );
};
