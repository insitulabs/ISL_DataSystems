<a name="readme-top"></a>

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://insitulabs.org">
    <img src="https://insitulabs.org/static-assets/isl-logo.png" alt="Logo" width="80" height="80">
  </a>

  <h3 align="center">In Situ Laboratory Data Systems</h3>
</div>


<!-- ABOUT THE PROJECT -->
## About

[![Data System Screen Shot](https://insitulabs.org/static-assets/data-viewer-screenshot.jpg?v=1)](https://insitulabs.org/static-assets/data-viewer-screenshot.jpg)

The In Situ Laboratory Data System is a combination of tools to capture, organize, clean, and synchornize data for a variety of downstream applications. The following describes the flow of data:

[![Data System Screen Shot](https://insitulabs.org/static-assets/isl-data-system-flow.jpg?v=1)](https://insitulabs.org/static-assets/isl-data-system-flow.jpg)


1. ODK input forms are designed to allow researchers to collect data in a standardized way.
1. The forms are loaded onto mobile devices (phone, tablet) using ODK Collect (Andriod) or GIC Collect (Os) and data is captured offline.
1. When the mobile device acquire an internet connection, the data is uploaded to an [ODK Central](https://github.com/getodk/central) server.
1. Within minutes the data is extracted from the [ODK Central](https://github.com/getodk/central) server and stored in a [MongoDB](https://www.mongodb.com) database. MongoDB allows for storing arbitrary documents, removing the complexity of fixed data typing or normalizing of raw data in the initial collection stage.
   * Note: The usage of [ODK Central](https://github.com/getodk/central) is not required.
   The data system is designed to be data source agnostic.
1. Our custom data viewer tool allows researchers to:
    * Manage access to the data.
       * Users are granted secure access to the system without the need to manage a password.
    * Review source data collections with basic filter and sorting options.
    * Create, modify, archive, or delete variables in source data collections
    * Correct mistakes in the data with simple or bulk edit tools.
    * Upload additional binary attachments to go along with the data.
    * Create customized views of single and multi-source data
    * Link data sources with look-up variables
    * Populate new data sources with copy-to functions
    * Export cleaned and organized data


Additional Screenshots:

**User Management**
[![Data System User Management](https://insitulabs.org/static-assets/isl-data-user-list.jpg?v=1)](https://insitulabs.org/static-assets/isl-data-user-list.jpg)

[![Data System User Management](https://insitulabs.org/static-assets/isl-data-user-edit.jpg?v=1)](https://insitulabs.org/static-assets/isl-data-user-edit.jpg)


<p align="right">(<a href="#readme-top">back to top</a>)</p>


<!--
## Getting Started

This is an example of how you may give instructions on setting up your project locally.
To get a local copy up and running follow these simple example steps.

### Prerequisites

This is an example of how to list things you need to use the software and how to install them.
* npm
  ```sh
  npm install npm@latest -g
  ```

### Installation

1. Get a free API Key at [https://example.com](https://example.com)
2. Clone the repo
   ```sh
   git clone https://github.com/github_username/repo_name.git
   ```
3. Install NPM packages
   ```sh
   npm install
   ```
4. Enter your API in `config.js`
   ```js
   const API_KEY = 'ENTER YOUR API';
   ```

<p align="right">(<a href="#readme-top">back to top</a>)</p>


## Usage

Use this space to show useful examples of how a project can be used. Additional screenshots, code examples and demos work well in this space. You may also link to more resources.

_For more examples, please refer to the [Documentation](https://example.com)_

<p align="right">(<a href="#readme-top">back to top</a>)</p>
-->


## Features

- [x] Automated import of data feeds from ODK Central
- [x] Manual import of SOURCE data from tab or comma dilimited text files
- [x] User management with form based access control lists
- [x] Auditing of data access, imports, exports, edits, source and view creation
- [x] Inline data editing
- [x] Source filtering and visible column selection
- [x] Source column renaming
- [x] Custom views to aggregate source data
- [x] Data typing and modification, including auto-increment fields
- [x] Record transpose or explode of record field
- [x] CSV Import
- [x] Source and record archiving
- [x] Source look-up and copy-to features
- [x] Data isolation through workspaces

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## In-progress

- [x] bulk append column data to records
- [x] Separate creator and editor user roles
- [x] Data Viewer tutorial and help page


## Background

This work is part of the [In Situ Laboratory Initiative](https://insitulabs.org/) to support a global decentralized biosurveillance network. Historically, biological sample collection at remote field locations and laboratory analyses have been carried out independently of one another, by separate institutions and/or groups of stakeholders. Most data systems that support these distinct parts of the research process have been developed in isolation, and remain 1) unintegrated or 2) unadaptable to diverse environments with power and data service constraints. As we endeavor to set-up more fully-functional molecular laboratories in the field (in-situ), our goal is to seamlessly integrate biological sample collection with laboratory sample analysis and data sharing applications in an intuitive, user-friendly, and secure way. We strive to build off of other prior openware initiatives, and remain committed to making all our data system tools freely available for scientific research, public health, and conservation applications.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

At this time, we're not seeking public contribution. This may change in the future.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the MIT License. See [LICENSE.txt](LICENSE.txt)
 for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

[https://insitulabs.org/how-to/contact-us/](https://insitulabs.org/how-to/contact-us/)

<p align="right">(<a href="#readme-top">back to top</a>)</p>


<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Gordon and Betty Moore Foundation](https://www.moore.org/)
* [US Forest Service](https://www.fs.usda.gov/)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
