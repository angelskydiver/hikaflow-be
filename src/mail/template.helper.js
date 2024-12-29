import { HelperDelegate } from 'handlebars';

export const isEqual: HelperDelegate = function (a, b, options) {
  if (a == b) {
    return options.fn(this);
  } else {
    return options.inverse(this);
  }
};

export const isOrganizer: HelperDelegate = function (organizedId, participantId, options) {
  if (organizedId == participantId) {
    return options.fn(this);
  } else {
    return options.inverse(this);
  }
};

export const isCreator: HelperDelegate = function (creatorId, participantId, options) {
  if (creatorId == participantId) {
    return options.fn(this);
  } else {
    return options.inverse(this);
  }
};