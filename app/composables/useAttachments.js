import { ref, computed } from 'vue';

// Maximum file size: 20MB
const MAX_FILE_SIZE = 20 * 1024 * 1024;

// Maximum number of attachments
const MAX_ATTACHMENTS = 4;

// Allowed file types
const ALLOWED_TYPES = {
    'image/png': 'image',
    'image/jpeg': 'image',
    'image/jpg': 'image',
    'image/webp': 'image',
    'image/gif': 'image',
    'application/pdf': 'pdf'
};

const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf'];

/**
 * Composable for managing file attachments in the message form
 * @returns {Object} Attachment state and methods
 */
export function useAttachments() {
    const attachments = ref([]);
    const error = ref(null);

    const hasAttachments = computed(() => attachments.value.length > 0);
    const hasImages = computed(() => attachments.value.some(a => a.type === 'image'));
    const hasPDFs = computed(() => attachments.value.some(a => a.type === 'pdf'));

    /**
     * Validates a file before adding
     * @param {File} file - The file to validate
     * @param {boolean} supportsVision - Whether the current model supports vision
     * @returns {{ valid: boolean, error?: string }}
     */
    function validateFile(file, supportsVision = false) {
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
            return {
                valid: false,
                error: `File "${file.name}" exceeds the 20MB size limit.`
            };
        }

        // Get file extension
        const extension = file.name.split('.').pop()?.toLowerCase();

        // Check if file type is allowed
        const fileType = ALLOWED_TYPES[file.type];
        const isAllowedExtension = ALLOWED_EXTENSIONS.includes(extension);

        if (!fileType && !isAllowedExtension) {
            return {
                valid: false,
                error: `File type not supported. Allowed: PNG, JPG, WEBP, GIF, PDF.`
            };
        }

        // Determine if it's an image
        const isImage = fileType === 'image' || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension);

        // Images require vision-capable model, PDFs work with any model
        if (isImage && !supportsVision) {
            return {
                valid: false,
                error: `The current model does not support image analysis. Please select a vision-capable model or upload a PDF.`
            };
        }

        return { valid: true };
    }

    /**
     * Converts a file to a data URL (base64)
     * @param {File} file - The file to convert
     * @returns {Promise<string>} The data URL
     */
    async function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    /**
     * Adds a file to the attachments list
     * @param {File} file - The file to add
     * @param {boolean} supportsVision - Whether the current model supports vision
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    async function addFile(file, supportsVision = false) {
        // Clear previous error
        error.value = null;

        // Check attachment limit
        if (attachments.value.length >= MAX_ATTACHMENTS) {
            error.value = `Maximum of ${MAX_ATTACHMENTS} attachments allowed.`;
            return { success: false, error: error.value };
        }

        // Validate file
        const validation = validateFile(file, supportsVision);
        if (!validation.valid) {
            error.value = validation.error;
            return { success: false, error: validation.error };
        }

        try {
            const dataUrl = await fileToDataUrl(file);

            // Determine type from MIME type or extension
            const extension = file.name.split('.').pop()?.toLowerCase();
            const type = ALLOWED_TYPES[file.type] ||
                (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension) ? 'image' : 'pdf');

            attachments.value.push({
                id: crypto.randomUUID(),
                type,
                filename: file.name,
                dataUrl,
                mimeType: file.type || (type === 'pdf' ? 'application/pdf' : `image/${extension}`)
            });

            return { success: true };
        } catch (err) {
            const errorMsg = `Failed to process file "${file.name}".`;
            error.value = errorMsg;
            return { success: false, error: errorMsg };
        }
    }

    /**
     * Removes an attachment by ID
     * @param {string} id - The attachment ID to remove
     */
    function removeAttachment(id) {
        attachments.value = attachments.value.filter(a => a.id !== id);
    }

    /**
     * Clears all attachments
     */
    function clearAttachments() {
        attachments.value = [];
        error.value = null;
    }

    /**
     * Clears the current error
     */
    function clearError() {
        error.value = null;
    }

    return {
        attachments,
        error,
        hasAttachments,
        hasImages,
        hasPDFs,
        addFile,
        removeAttachment,
        clearAttachments,
        clearError,
        MAX_FILE_SIZE,
        MAX_ATTACHMENTS,
        ALLOWED_EXTENSIONS
    };
}
