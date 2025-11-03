import {
  BOT_BRANCH_PATTERNS,
  DEFAULT_BRANCH_PATTERNS,
  HIDDEN_MARKER_END,
  HIDDEN_MARKER_START,
  JIRA_REGEX_MATCHER,
  WARNING_MESSAGE_ABOUT_HIDDEN_MARKERS,
} from './constants';
import { JIRADetails } from './types';

const getJIRAIssueKey = (input: string, regexp: RegExp = JIRA_REGEX_MATCHER): string | null => {
  const matches = regexp.exec(input);
  return matches ? matches[matches.length - 1] : null;
};

// New function to extract multiple JIRA issue keys
const getJIRAIssueKeys = (input: string, regexp: RegExp = JIRA_REGEX_MATCHER): string[] => {
  const keys: string[] = [];
  const globalRegexp = new RegExp(regexp.source, 'gi');
  let match;

  while ((match = globalRegexp.exec(input)) !== null) {
    keys.push(match[match.length - 1]);
  }

  return keys;
};

export const getJIRAIssueKeyByDefaultRegexp = (input: string): string | null => {
  const key = getJIRAIssueKey(input, new RegExp(JIRA_REGEX_MATCHER));
  return key ? key.toUpperCase() : null;
};

// New function to extract multiple JIRA issue keys using default regexp
export const getJIRAIssueKeysByDefaultRegexp = (input: string): string[] => {
  const keys = getJIRAIssueKeys(input, JIRA_REGEX_MATCHER);
  return keys.map(key => key.toUpperCase());
};

export const getJIRAIssueKeysByCustomRegexp = (input: string, numberRegexp: string, projectKey?: string): string | null => {
  const customRegexp = new RegExp(numberRegexp, 'gi');

  const ticketNumber = getJIRAIssueKey(input, customRegexp);
  if (!ticketNumber) {
    return null;
  }
  const key = projectKey ? `${projectKey}-${ticketNumber}` : ticketNumber;
  return key.toUpperCase();
};

// New function to extract multiple JIRA issue keys using custom regexp
export const getMultipleJIRAIssueKeysByCustomRegexp = (input: string, numberRegexp: string, projectKey?: string): string[] => {
  const customRegexp = new RegExp(numberRegexp, 'gi');
  const ticketNumbers = getJIRAIssueKeys(input, customRegexp);

  return ticketNumbers.map(ticketNumber => {
    const key = projectKey ? `${projectKey}-${ticketNumber}` : ticketNumber;
    return key.toUpperCase();
  });
};

export const shouldSkipBranch = (branch: string, additionalIgnorePattern?: string): boolean => {
  if (BOT_BRANCH_PATTERNS.some((pattern) => pattern.test(branch))) {
    console.log(`You look like a bot 🤖 so we're letting you off the hook!`);
    return true;
  }

  if (DEFAULT_BRANCH_PATTERNS.some((pattern) => pattern.test(branch))) {
    console.log(`Ignoring check for default branch ${branch}`);
    return true;
  }

  const ignorePattern = new RegExp(additionalIgnorePattern || '');
  if (!!additionalIgnorePattern && ignorePattern.test(branch)) {
    console.log(`branch '${branch}' ignored as it matches the ignore pattern '${additionalIgnorePattern}' provided in skip-branches`);
    return true;
  }

  return false;
};

const escapeRegexp = (str: string): string => {
  return str.replace(/[\\^$.|?*+(<>)[{]/g, '\\$&');
};

export const getPRDescription = (oldBody: string, details: string): string => {
  const hiddenMarkerStartRg = escapeRegexp(HIDDEN_MARKER_START);
  const hiddenMarkerEndRg = escapeRegexp(HIDDEN_MARKER_END);
  const warningMsgRg = escapeRegexp(WARNING_MESSAGE_ABOUT_HIDDEN_MARKERS);

  const replaceDetailsRg = new RegExp(`${hiddenMarkerStartRg}([\\s\\S]+)${hiddenMarkerEndRg}[\\s]?`, 'igm');
  const replaceWarningMessageRg = new RegExp(`${warningMsgRg}[\\s]?`, 'igm');
  const jiraDetailsMessage = `${WARNING_MESSAGE_ABOUT_HIDDEN_MARKERS}
${HIDDEN_MARKER_START}
${details}
${HIDDEN_MARKER_END}
`;
  if (replaceDetailsRg.test(oldBody)) {
    return (oldBody ?? '').replace(replaceWarningMessageRg, '').replace(replaceDetailsRg, jiraDetailsMessage);
  }
  return jiraDetailsMessage + oldBody;
};

export const buildPRDescription = (details: JIRADetails) => {
  const displayKey = details.key.toUpperCase();
  return `<table><tbody><tr><td>
  <a href="${details.url}" title="${displayKey}" target="_blank"><img alt="${details.type.name}" src="${details.type.icon}" /> ${displayKey}</a>
  ${details.summary}
</td></tr></tbody></table>`;
};

// New function to build PR description for multiple JIRA issues
export const buildMultipleJIRAPRDescription = (detailsList: JIRADetails[]) => {
  if (detailsList.length === 0) {
    return '';
  }

  if (detailsList.length === 1) {
    return buildPRDescription(detailsList[0]);
  }

  const rows = detailsList.map(details => {
    const displayKey = details.key.toUpperCase();
    return `<tr><td>
    <a href="${details.url}" title="${displayKey}" target="_blank"><img alt="${details.type.name}" src="${details.type.icon}" /> ${displayKey}</a>
    ${details.summary}
  </td></tr>`;
  }).join('\n');

  return `<table><tbody>\n${rows}\n</tbody></table>`;
};
