import { unnecessaryFiles } from '../constants/unnecessary.files.constant';

export function filterFiles(files) {
  const filteredFiles = files.filter((file) => {
    const filename = file.filename; // Extract filename from path
    return !unnecessaryFiles.some((unnecessaryFile) =>
      filename.includes(unnecessaryFile),
    );
  });
  return filteredFiles;
}
