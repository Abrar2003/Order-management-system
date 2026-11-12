import { useRef, useState } from "react";
import { prepareOrderReferenceUpload } from "../services/orders.service";
import { uploadFileToPresignedWasabiUrl } from "../services/qcImages.service";

export default function useOrderReferenceUpload() {
  const sessionRef = useRef(null);
  const [progress, setProgress] = useState("");

  const submit = async (target, files, commit) => {
    const targetKey = JSON.stringify(target);
    let session = sessionRef.current;
    try {
      if (!session || session.targetKey !== targetKey || session.files !== files ||
          Date.parse(session.upload.expires_at) <= Date.now()) {
        setProgress("Preparing document upload…");
        const upload = await prepareOrderReferenceUpload(target, files);
        session = { targetKey, files, upload, completed: new Set() };
        sessionRef.current = session;
      }
      for (const [index, file] of files.entries()) {
        if (session.completed.has(index)) continue;
        setProgress(`Uploading document ${index + 1} of ${files.length}…`);
        const signed = session.upload.files[index];
        try {
          await uploadFileToPresignedWasabiUrl({ file, uploadUrl: signed.upload_url, headers: signed.headers });
        } catch {
          throw new Error(`Could not upload ${file.name}. Retry to continue.`);
        }
        session.completed.add(index);
      }
      setProgress("Saving documents…");
      const result = await commit(session.upload.upload_id);
      sessionRef.current = null;
      return result;
    } catch (error) {
      const code = error?.response?.data?.code;
      if (code === "REFERENCE_UPLOAD_EXPIRED") sessionRef.current = null;
      if (code === "REFERENCE_UPLOAD_INCOMPLETE") session?.completed.clear();
      throw error;
    } finally {
      setProgress("");
    }
  };

  return { submit, progress };
}
