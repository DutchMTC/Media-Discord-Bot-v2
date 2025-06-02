/**
 * Parses a timeframe string and returns an object with startDate and endDate.
 * @param {string} timeframeString - The timeframe string (e.g., "7d", "1m", "YYYY-MM-DD_YYYY-MM-DD").
 * @returns {{startDate: Date, endDate: Date} | null} - Object with startDate and endDate, or null if parsing fails.
 */
function parseTimeframe(timeframeString) {
    const now = new Date();
    let startDate = new Date(now);
    const endDate = new Date(now);

    const customRangeMatch = timeframeString.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
    if (customRangeMatch) {
        try {
            const start = new Date(customRangeMatch[1]);
            const end = new Date(customRangeMatch[2]);
            // Set end of day for the end date
            end.setHours(23, 59, 59, 999);
            if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
                return null;
            }
            return { startDate: start, endDate: end };
        } catch (e) {
            return null;
        }
    }

    const durationMatch = timeframeString.match(/^(\d+)([dmy])$/);
    if (!durationMatch) {
        return null; // Invalid format
    }

    const value = parseInt(durationMatch[1]);
    const unit = durationMatch[2];

    switch (unit) {
        case 'd':
            startDate.setDate(now.getDate() - value);
            break;
        case 'm':
            startDate.setMonth(now.getMonth() - value);
            break;
        case 'y':
            startDate.setFullYear(now.getFullYear() - value);
            break;
        default:
            return null; // Should not happen due to regex
    }
    startDate.setHours(0, 0, 0, 0); // Set to the beginning of the start day

    return { startDate, endDate };
}

module.exports = { parseTimeframe };