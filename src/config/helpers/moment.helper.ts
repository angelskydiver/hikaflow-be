import * as moment from 'moment';

/**
 * Helper function to get the current time plus a specified amount of time.
 * @param minutes The number of minutes to add to the current time.
 * @returns The future date-time in JavaScript Date format.
 */
export const getExpiryTime = (minutes: number): Date => {
  return moment().add(minutes, 'minutes').toDate();
};
