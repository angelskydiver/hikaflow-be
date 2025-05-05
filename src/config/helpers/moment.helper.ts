import * as moment from 'moment';

/**
 * Helper function to get the current time plus a specified amount of time.
 * @param minutes The number of minutes to add to the current time.
 * @returns The future date-time in JavaScript Date format.
 */
export const getExpiryTime = (minutes: number): Date => {
  return moment().add(minutes, 'minutes').toDate();
};

/*
{
  "id": "84406a0f-81ea-454a-a234-dc647662a0c5",
  "filePath": "src/config/helpers/moment.helper.ts",
  "imports": ["moment"],
  "exports": ["oneMonthFromNow", "fiveMinutesFromNow", "getExpiryTime"],
  "functions": [
    {
      "name": "oneMonthFromNow", 
      "invokedIn": [], 
      "parameters": [], 
      "returnType": "moment.Moment", 
      "description": "Calculates and returns a `moment` object representing the date and time one month from the current moment.", 
      "relatedFunctions": ["fiveMinutesFromNow"]
    }, 
    {
      "name": "fiveMinutesFromNow", 
      "invokedIn": [], 
      "parameters": [], 
      "returnType": "moment.Moment", 
      "description": "Calculates and returns a `moment` object representing the date and time five minutes from the current moment.", 
      "relatedFunctions": ["oneMonthFromNow"]
    },
    {
      "name": "getExpiryTime", 
      "invokedIn": ["verificationCode.service.ts"], 
      "parameters": [{"name": "minutes", "type": "number"}], 
      "returnType": "Date", 
      "description": "Helper function to get the current time plus a specified amount of minutes."
    }
  ],
  "documentation": "This file provides utility functions for date and time manipulation using the `moment` library. It is designed to simplify common date/time operations by offering ready-to-use functions that return future dates based on the current time. The functions abstract away the direct use of `moment`, making the code cleaner and more maintainable. They are stateless and pure, ensuring predictable behavior."
}
*/
